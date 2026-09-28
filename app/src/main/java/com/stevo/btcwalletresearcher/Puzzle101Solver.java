package com.stevo.btcwalletresearcher;

import android.content.Context;
import android.content.SharedPreferences;

import org.bouncycastle.asn1.x9.X9ECParameters;
import org.bouncycastle.crypto.digests.RIPEMD160Digest;
import org.bouncycastle.crypto.ec.CustomNamedCurves;
import org.bouncycastle.math.ec.ECPoint;

import java.math.BigInteger;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicReferenceArray;

public final class Puzzle101Solver {
    public static final String TARGET_ADDRESS = "1CKCVdbDJasYmhswB6HKZHEAnNaDpK7W4n";
    public static final String RANGE_START_HEX = "10000000000000000000000000";
    public static final String RANGE_END_HEX = "1fffffffffffffffffffffffff";
    public static final String TARGET_HASH160_HEX = "7c1a77205c03b9909663b2034faa0b544e6bc96b";

    private static final BigInteger RANGE_START = new BigInteger(RANGE_START_HEX, 16);
    private static final BigInteger RANGE_END = new BigInteger(RANGE_END_HEX, 16);
    private static final BigInteger RANGE_SIZE = BigInteger.ONE.shiftLeft(100);
    private static final BigInteger ONE = BigInteger.ONE;

    // Larger batches reduce the cost of elliptic-curve normalization.
    private static final int EC_BATCH = 512;
    // Workers claim non-overlapping contiguous chunks. This avoids duplicate work
    // while keeping expensive scalar multiplication to roughly one per chunk.
    private static final int CHUNK_SIZE = 1 << 16;

    private static final String PREFS = "puzzle101_solver";
    private static final String PREF_CURRENT = "current_hex";
    private static final String PREF_TOTAL = "total_checked";

    private final SharedPreferences prefs;
    private final SecureRandom secureRandom = new SecureRandom();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicLong sessionCounter = new AtomicLong(0L);
    private final AtomicLong totalCounter = new AtomicLong(0L);
    private final AtomicReference<String> foundHex = new AtomicReference<>(null);
    private final Object chunkLock = new Object();

    private volatile Thread supervisor;
    private volatile BigInteger currentKey;
    private volatile BigInteger nextChunkStart;
    private volatile AtomicReferenceArray<BigInteger> workerPositions = new AtomicReferenceArray<>(0);
    private volatile double lastSpeed;
    private volatile String lastError = "";
    private volatile int activeWorkerCount;

    public interface Listener {
        void onState(State state);
        void onFound(State state, String privateKeyHex);
        void onError(String message);
    }

    public static final class State {
        public final boolean running;
        public final String currentHex;
        public final long sessionChecked;
        public final long totalChecked;
        public final double keysPerSecond;
        public final String error;
        public final int workerCount;

        State(
                boolean running,
                String currentHex,
                long sessionChecked,
                long totalChecked,
                double keysPerSecond,
                String error,
                int workerCount
        ) {
            this.running = running;
            this.currentHex = currentHex;
            this.sessionChecked = sessionChecked;
            this.totalChecked = totalChecked;
            this.keysPerSecond = keysPerSecond;
            this.error = error == null ? "" : error;
            this.workerCount = workerCount;
        }
    }

    public Puzzle101Solver(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        String stored = prefs.getString(PREF_CURRENT, RANGE_START_HEX);
        BigInteger restored;
        try {
            restored = new BigInteger(stored, 16);
        } catch (Exception ignored) {
            restored = RANGE_START;
        }

        if (restored.compareTo(RANGE_START) < 0 || restored.compareTo(RANGE_END) > 0) {
            restored = RANGE_START;
        }

        currentKey = restored;
        nextChunkStart = restored;
        totalCounter.set(Math.max(0L, prefs.getLong(PREF_TOTAL, 0L)));
    }

    public synchronized void start(Listener listener) {
        if (running.get()) {
            if (listener != null) listener.onState(snapshot());
            return;
        }

        int cores = Math.max(1, Runtime.getRuntime().availableProcessors());
        // Use the phone aggressively, but cap at 8 workers so the UI remains usable.
        activeWorkerCount = Math.max(1, Math.min(8, cores));

        sessionCounter.set(0L);
        lastSpeed = 0.0;
        lastError = "";
        foundHex.set(null);
        nextChunkStart = currentKey;
        workerPositions = new AtomicReferenceArray<>(activeWorkerCount);
        running.set(true);

        if (listener != null) listener.onState(snapshot());

        supervisor = new Thread(
                () -> runParallelSolver(listener, activeWorkerCount),
                "Puzzle101Supervisor"
        );
        supervisor.setPriority(Thread.NORM_PRIORITY);
        supervisor.start();
    }

    public synchronized void stop(Listener listener) {
        running.set(false);
        currentKey = computeSafeResumeKey();
        saveCheckpoint();
        if (listener != null) listener.onState(snapshot());
    }

    public synchronized State newRandomShard() {
        running.set(false);
        BigInteger offset = new BigInteger(100, secureRandom);
        currentKey = RANGE_START.add(offset);
        nextChunkStart = currentKey;
        sessionCounter.set(0L);
        lastSpeed = 0.0;
        lastError = "";
        foundHex.set(null);
        activeWorkerCount = 0;
        saveCheckpoint();
        return snapshot();
    }

    public synchronized State resetToRangeStart() {
        running.set(false);
        currentKey = RANGE_START;
        nextChunkStart = RANGE_START;
        sessionCounter.set(0L);
        totalCounter.set(0L);
        lastSpeed = 0.0;
        lastError = "";
        foundHex.set(null);
        activeWorkerCount = 0;
        saveCheckpoint();
        return snapshot();
    }

    public State snapshot() {
        BigInteger safe = running.get() ? computeSafeResumeKey() : currentKey;
        return new State(
                running.get(),
                to64Hex(safe),
                sessionCounter.get(),
                totalCounter.get(),
                lastSpeed,
                lastError,
                activeWorkerCount
        );
    }

    public boolean selfTest() {
        try {
            lastError = "";
            X9ECParameters params = CustomNamedCurves.getByName("secp256k1");
            if (params == null) return false;

            // Known Bitcoin compressed public key HASH160 for private key x = 1.
            byte[] pub = params.getG().multiply(BigInteger.ONE).normalize().getEncoded(true);
            byte[] actual = hash160(pub);
            byte[] expected = hexToBytes("751e76e8199196d454941c45d1b3a323f1433bd6");
            return Arrays.equals(actual, expected);
        } catch (Exception e) {
            lastError = e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage());
            return false;
        }
    }

    private void runParallelSolver(Listener listener, int workerCount) {
        Thread[] workers = new Thread[workerCount];

        try {
            X9ECParameters params = CustomNamedCurves.getByName("secp256k1");
            if (params == null) throw new IllegalStateException("secp256k1 is unavailable.");

            ECPoint generator = params.getG();
            byte[] targetHash160 = hexToBytes(TARGET_HASH160_HEX);

            for (int i = 0; i < workerCount; i++) {
                final int workerId = i;
                workers[i] = new Thread(
                        () -> runWorker(workerId, params, generator, targetHash160),
                        "Puzzle101Worker-" + i
                );
                workers[i].setPriority(Thread.NORM_PRIORITY);
                workers[i].start();
            }

            long lastReportAt = System.nanoTime();
            long lastReportCount = sessionCounter.get();
            long lastCheckpointAt = lastReportAt;

            while (true) {
                boolean anyAlive = false;
                for (Thread worker : workers) {
                    if (worker != null && worker.isAlive()) {
                        anyAlive = true;
                        break;
                    }
                }

                if (!anyAlive) break;

                try {
                    Thread.sleep(250L);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                    running.set(false);
                }

                long now = System.nanoTime();
                if (now - lastReportAt >= 1_000_000_000L) {
                    long checked = sessionCounter.get();
                    double seconds = (now - lastReportAt) / 1_000_000_000.0;
                    lastSpeed = (checked - lastReportCount) / Math.max(0.001, seconds);
                    lastReportCount = checked;
                    lastReportAt = now;

                    currentKey = computeSafeResumeKey();
                    if (listener != null) listener.onState(snapshot());
                }

                if (now - lastCheckpointAt >= 4_000_000_000L) {
                    currentKey = computeSafeResumeKey();
                    saveCheckpoint();
                    lastCheckpointAt = now;
                }
            }

            for (Thread worker : workers) {
                if (worker == null) continue;
                try {
                    worker.join(250L);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }

            String found = foundHex.get();
            if (found != null) {
                currentKey = new BigInteger(found, 16);
                running.set(false);
                saveCheckpoint();
                if (listener != null) listener.onFound(snapshot(), found);
                return;
            }

            currentKey = computeSafeResumeKey();
        } catch (Throwable t) {
            running.set(false);
            lastError = t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
            if (listener != null) listener.onError(lastError);
        } finally {
            running.set(false);
            currentKey = foundHex.get() != null
                    ? new BigInteger(foundHex.get(), 16)
                    : computeSafeResumeKey();
            saveCheckpoint();
            if (listener != null) listener.onState(snapshot());
        }
    }

    private void runWorker(
            int workerId,
            X9ECParameters params,
            ECPoint generator,
            byte[] targetHash160
    ) {
        try {
            MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
            RIPEMD160Digest ripemd = new RIPEMD160Digest();

            while (running.get()) {
                BigInteger chunkStart = claimChunk(workerId);
                if (chunkStart == null) return;

                BigInteger chunkEnd = chunkStart
                        .add(BigInteger.valueOf(CHUNK_SIZE - 1L))
                        .min(RANGE_END);

                BigInteger key = chunkStart;
                ECPoint point = generator.multiply(key);

                while (running.get() && key.compareTo(chunkEnd) <= 0) {
                    BigInteger remaining = chunkEnd.subtract(key).add(ONE);
                    int count = remaining.compareTo(BigInteger.valueOf(EC_BATCH)) < 0
                            ? remaining.intValue()
                            : EC_BATCH;

                    ECPoint[] points = new ECPoint[count];
                    ECPoint nextPoint = point;

                    for (int i = 0; i < count; i++) {
                        points[i] = nextPoint;
                        nextPoint = nextPoint.add(generator);
                    }

                    params.getCurve().normalizeAll(points, 0, count, null);

                    int processed = 0;
                    for (int i = 0; i < count && running.get(); i++) {
                        BigInteger candidate = key.add(BigInteger.valueOf(i));

                        byte[] compressedPublicKey = points[i].getEncoded(true);
                        byte[] sha = sha256.digest(compressedPublicKey);
                        ripemd.update(sha, 0, sha.length);

                        byte[] candidateHash160 = new byte[20];
                        ripemd.doFinal(candidateHash160, 0);

                        if (Arrays.equals(candidateHash160, targetHash160)) {
                            String match = to64Hex(candidate);
                            if (foundHex.compareAndSet(null, match)) {
                                currentKey = candidate;
                                workerPositions.set(workerId, candidate);
                                running.set(false);
                            }
                            return;
                        }

                        processed++;
                        sessionCounter.incrementAndGet();
                        totalCounter.incrementAndGet();

                        // Publish progress often enough to make a manual stop safe.
                        if ((processed & 63) == 0) {
                            workerPositions.set(workerId, candidate.add(ONE));
                        }
                    }

                    key = key.add(BigInteger.valueOf(processed));
                    workerPositions.set(workerId, key);

                    if (processed == count) {
                        point = nextPoint;
                    } else if (running.get() && key.compareTo(chunkEnd) <= 0) {
                        point = generator.multiply(key);
                    }
                }

                if (key.compareTo(chunkEnd) > 0) {
                    workerPositions.set(workerId, null);
                }
            }
        } catch (Throwable t) {
            if (lastError == null || lastError.isEmpty()) {
                lastError = "Worker " + (workerId + 1) + ": " +
                        t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
            }
            running.set(false);
        }
    }

    private BigInteger claimChunk(int workerId) {
        synchronized (chunkLock) {
            if (!running.get()) return null;

            BigInteger start = nextChunkStart == null ? currentKey : nextChunkStart;
            if (start == null) start = RANGE_START;
            if (start.compareTo(RANGE_END) > 0) return null;

            BigInteger next = start.add(BigInteger.valueOf(CHUNK_SIZE));
            nextChunkStart = next;
            workerPositions.set(workerId, start);
            return start;
        }
    }

    private BigInteger computeSafeResumeKey() {
        BigInteger min = nextChunkStart;
        if (min == null) min = currentKey;
        if (min == null) min = RANGE_START;

        AtomicReferenceArray<BigInteger> positions = workerPositions;
        for (int i = 0; i < positions.length(); i++) {
            BigInteger p = positions.get(i);
            if (p != null && p.compareTo(min) < 0) {
                min = p;
            }
        }

        if (min.compareTo(RANGE_START) < 0) return RANGE_START;
        if (min.compareTo(RANGE_END) > 0) return RANGE_END;
        return min;
    }

    private synchronized void saveCheckpoint() {
        BigInteger safe = foundHex.get() != null
                ? new BigInteger(foundHex.get(), 16)
                : computeSafeResumeKey();

        prefs.edit()
                .putString(PREF_CURRENT, to64Hex(safe))
                .putLong(PREF_TOTAL, totalCounter.get())
                .apply();
    }

    public static double fractionOfFullRange(long checked) {
        if (checked <= 0) return 0.0;
        return new BigInteger(Long.toString(checked)).doubleValue() / RANGE_SIZE.doubleValue();
    }

    private static byte[] hash160(byte[] input) throws Exception {
        MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
        byte[] sha = sha256.digest(input);

        RIPEMD160Digest ripemd = new RIPEMD160Digest();
        ripemd.update(sha, 0, sha.length);
        byte[] out = new byte[20];
        ripemd.doFinal(out, 0);
        return out;
    }

    private static String to64Hex(BigInteger value) {
        String h = value == null ? RANGE_START_HEX : value.toString(16).toLowerCase(Locale.US);
        StringBuilder out = new StringBuilder(64);
        for (int i = h.length(); i < 64; i++) out.append('0');
        out.append(h);
        return out.toString();
    }

    private static byte[] hexToBytes(String hex) {
        int len = hex.length();
        byte[] out = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            out[i / 2] = (byte) Integer.parseInt(hex.substring(i, i + 2), 16);
        }
        return out;
    }
}
