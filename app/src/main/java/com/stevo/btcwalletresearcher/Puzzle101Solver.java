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
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

public final class Puzzle101Solver {
    // Legacy class name retained so the Android bridge remains compatible.
    // The engine itself is now fixed to the public Bitcoin Puzzle #140.
    public static final String TARGET_ADDRESS = "1QKBaU6WAeycb3DbKbLBkX7vJiaS8r42Xo";
    public static final String PUBLIC_KEY_HEX =
            "031f6a332d3c5c4f2de2378c012f429cd109ba07d69690c6c701b6bb87860d6640";
    public static final String TARGET_HASH160_HEX =
            "ffbb35a7bb9bbe16c1aa2534f7ff11d59c8e3d1a";
    public static final String RANGE_START_HEX = "80000000000000000000000000000000000";
    public static final String RANGE_END_HEX = "fffffffffffffffffffffffffffffffffff";

    private static final BigInteger RANGE_START = new BigInteger(RANGE_START_HEX, 16);
    private static final BigInteger RANGE_END = new BigInteger(RANGE_END_HEX, 16);
    private static final BigInteger RANGE_SIZE =
            RANGE_END.subtract(RANGE_START).add(BigInteger.ONE);

    // Pollard's Kangaroo parameters. Puzzle #140's interval contains 2^139
    // candidates, so expected work is on the order of sqrt(2^139) = 2^69.5.
    private static final int JUMP_COUNT = 32;
    private static final int DP_BITS = 10;
    private static final BigInteger DP_MASK =
            BigInteger.ONE.shiftLeft(DP_BITS).subtract(BigInteger.ONE);
    private static final int MAX_POINTS_PER_HERD = 30000;

    private static final String PREFS = "puzzle140_kangaroo";
    private static final String PREF_TOTAL = "total_jumps";

    private final SharedPreferences prefs;
    private final SecureRandom secureRandom = new SecureRandom();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicLong sessionCounter = new AtomicLong(0L);
    private final AtomicLong totalCounter = new AtomicLong(0L);
    private final AtomicReference<String> foundHex = new AtomicReference<>(null);

    private final Map<String, BigInteger> tamePoints =
            Collections.synchronizedMap(new BoundedPointMap());
    private final Map<String, BigInteger> wildPoints =
            Collections.synchronizedMap(new BoundedPointMap());

    private volatile Thread supervisor;
    private volatile double lastSpeed;
    private volatile String lastError = "";
    private volatile int activeWorkerCount;
    private volatile long runNonce;

    private static final class BoundedPointMap extends LinkedHashMap<String, BigInteger> {
        BoundedPointMap() {
            super(1024, 0.75f, true);
        }

        @Override
        protected boolean removeEldestEntry(Map.Entry<String, BigInteger> eldest) {
            return size() > MAX_POINTS_PER_HERD;
        }
    }

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
        public final int distinguishedPoints;
        public final String algorithm;

        State(
                boolean running,
                String currentHex,
                long sessionChecked,
                long totalChecked,
                double keysPerSecond,
                String error,
                int workerCount,
                int distinguishedPoints,
                String algorithm
        ) {
            this.running = running;
            this.currentHex = currentHex;
            this.sessionChecked = sessionChecked;
            this.totalChecked = totalChecked;
            this.keysPerSecond = keysPerSecond;
            this.error = error == null ? "" : error;
            this.workerCount = workerCount;
            this.distinguishedPoints = distinguishedPoints;
            this.algorithm = algorithm;
        }
    }

    public Puzzle101Solver(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        totalCounter.set(Math.max(0L, prefs.getLong(PREF_TOTAL, 0L)));
        runNonce = Math.abs(secureRandom.nextLong());
    }

    public synchronized void start(Listener listener) {
        if (running.get()) {
            if (listener != null) listener.onState(snapshot());
            return;
        }

        sessionCounter.set(0L);
        lastSpeed = 0.0;
        lastError = "";
        foundHex.set(null);
        tamePoints.clear();
        wildPoints.clear();
        runNonce = Math.abs(secureRandom.nextLong());

        int cores = Math.max(2, Runtime.getRuntime().availableProcessors());
        activeWorkerCount = Math.max(2, Math.min(6, cores));
        running.set(true);

        if (listener != null) listener.onState(snapshot());

        supervisor = new Thread(
                () -> runKangaroo(listener, activeWorkerCount),
                "Puzzle140KangarooSupervisor"
        );
        supervisor.setPriority(Thread.NORM_PRIORITY);
        supervisor.start();
    }

    public synchronized void stop(Listener listener) {
        running.set(false);
        saveCounters();
        if (listener != null) listener.onState(snapshot());
    }

    // Kept for the existing UI bridge. For Kangaroo this starts a fresh
    // randomized set of wild walks rather than selecting a brute-force shard.
    public synchronized State newRandomShard() {
        running.set(false);
        tamePoints.clear();
        wildPoints.clear();
        sessionCounter.set(0L);
        lastSpeed = 0.0;
        lastError = "";
        foundHex.set(null);
        runNonce = Math.abs(secureRandom.nextLong());
        activeWorkerCount = 0;
        saveCounters();
        return snapshot();
    }

    public synchronized State resetToRangeStart() {
        running.set(false);
        tamePoints.clear();
        wildPoints.clear();
        sessionCounter.set(0L);
        totalCounter.set(0L);
        lastSpeed = 0.0;
        lastError = "";
        foundHex.set(null);
        runNonce = 0L;
        activeWorkerCount = 0;
        saveCounters();
        return snapshot();
    }

    public State snapshot() {
        String current = foundHex.get();
        if (current == null) current = RANGE_START_HEX;

        return new State(
                running.get(),
                current,
                sessionCounter.get(),
                totalCounter.get(),
                lastSpeed,
                lastError,
                activeWorkerCount,
                tamePoints.size() + wildPoints.size(),
                "Pollard's Kangaroo"
        );
    }

    public boolean selfTest() {
        try {
            lastError = "";
            X9ECParameters params = CustomNamedCurves.getByName("secp256k1");
            if (params == null) {
                lastError = "secp256k1 is unavailable.";
                return false;
            }

            byte[] expectedPub = hexToBytes(PUBLIC_KEY_HEX);
            ECPoint point = params.getCurve().decodePoint(expectedPub).normalize();

            if (!Arrays.equals(point.getEncoded(true), expectedPub)) {
                lastError = "Published public key could not be decoded.";
                return false;
            }

            byte[] actualHash160 = hash160(expectedPub);
            byte[] expectedHash160 = hexToBytes(TARGET_HASH160_HEX);

            if (!Arrays.equals(actualHash160, expectedHash160)) {
                lastError = "Public key does not match the published Puzzle #140 address.";
                return false;
            }

            if (!KangarooSotaLab.selfTest()) {
                lastError = "SOTA collision laboratory self-test failed.";
                return false;
            }

            return true;
        } catch (Throwable t) {
            lastError = t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
            return false;
        }
    }

    private void runKangaroo(Listener listener, int workerCount) {
        Thread tameThread = null;
        Thread[] wildThreads = new Thread[Math.max(1, workerCount - 1)];

        try {
            X9ECParameters params = CustomNamedCurves.getByName("secp256k1");
            if (params == null) {
                throw new IllegalStateException("secp256k1 is unavailable.");
            }

            ECPoint generator = params.getG().normalize();
            ECPoint target = params.getCurve()
                    .decodePoint(hexToBytes(PUBLIC_KEY_HEX))
                    .normalize();

            BigInteger[] jumps = buildJumpScalars();
            ECPoint[] jumpPoints = new ECPoint[JUMP_COUNT];

            for (int i = 0; i < JUMP_COUNT; i++) {
                jumpPoints[i] = generator.multiply(jumps[i]).normalize();
            }

            tameThread = new Thread(
                    () -> runTame(generator, target, jumps, jumpPoints),
                    "Puzzle140Tame"
            );
            tameThread.setPriority(Thread.NORM_PRIORITY);
            tameThread.start();

            for (int i = 0; i < wildThreads.length; i++) {
                final int workerId = i;
                wildThreads[i] = new Thread(
                        () -> runWild(
                                workerId,
                                generator,
                                target,
                                jumps,
                                jumpPoints
                        ),
                        "Puzzle140Wild-" + workerId
                );
                wildThreads[i].setPriority(Thread.NORM_PRIORITY);
                wildThreads[i].start();
            }

            long lastReportAt = System.nanoTime();
            long lastReportCount = sessionCounter.get();

            while (running.get()) {
                try {
                    Thread.sleep(250L);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    running.set(false);
                    break;
                }

                long now = System.nanoTime();
                if (now - lastReportAt >= 1_000_000_000L) {
                    long checked = sessionCounter.get();
                    double seconds = (now - lastReportAt) / 1_000_000_000.0;
                    lastSpeed =
                            (checked - lastReportCount) / Math.max(0.001, seconds);
                    lastReportCount = checked;
                    lastReportAt = now;

                    saveCounters();
                    if (listener != null) listener.onState(snapshot());
                }

                boolean anyWildAlive = false;
                for (Thread worker : wildThreads) {
                    if (worker != null && worker.isAlive()) {
                        anyWildAlive = true;
                        break;
                    }
                }

                if (!anyWildAlive) {
                    running.set(false);
                    break;
                }
            }

            if (tameThread != null) {
                try {
                    tameThread.join(400L);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }

            for (Thread worker : wildThreads) {
                if (worker == null) continue;
                try {
                    worker.join(400L);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }

            String found = foundHex.get();
            if (found != null && listener != null) {
                listener.onFound(snapshot(), found);
            }
        } catch (Throwable t) {
            running.set(false);
            lastError =
                    t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
            if (listener != null) listener.onError(lastError);
        } finally {
            running.set(false);
            saveCounters();
            if (listener != null) listener.onState(snapshot());
        }
    }

    private void runTame(
            ECPoint generator,
            ECPoint target,
            BigInteger[] jumps,
            ECPoint[] jumpPoints
    ) {
        try {
            ECPoint point = generator.multiply(RANGE_END).normalize();
            BigInteger distance = BigInteger.ZERO;

            while (running.get()) {
                ECPoint normalized = point.normalize();
                BigInteger x = normalized.getAffineXCoord().toBigInteger();

                if (isDistinguished(x)) {
                    String key = pointKey(normalized);
                    BigInteger wildDistance = wildPoints.get(key);

                    if (wildDistance != null &&
                            testCandidate(
                                    RANGE_END.add(distance).subtract(wildDistance),
                                    generator,
                                    target
                            )) {
                        return;
                    }

                    tamePoints.put(key, distance);
                }

                int index = jumpIndex(x);
                point = normalized.add(jumpPoints[index]);
                distance = distance.add(jumps[index]);
                countJump();
            }
        } catch (Throwable t) {
            setWorkerError("Tame", t);
        }
    }

    private void runWild(
            int workerId,
            ECPoint generator,
            ECPoint target,
            BigInteger[] jumps,
            ECPoint[] jumpPoints
    ) {
        try {
            BigInteger offset = initialWildOffset(workerId);
            ECPoint point =
                    target.add(generator.multiply(offset)).normalize();
            BigInteger distance = offset;

            while (running.get()) {
                ECPoint normalized = point.normalize();
                BigInteger x = normalized.getAffineXCoord().toBigInteger();

                if (isDistinguished(x)) {
                    String key = pointKey(normalized);
                    BigInteger tameDistance = tamePoints.get(key);

                    if (tameDistance != null &&
                            testCandidate(
                                    RANGE_END.add(tameDistance).subtract(distance),
                                    generator,
                                    target
                            )) {
                        return;
                    }

                    // This also allows a tame walk that arrives later to detect
                    // the collision, avoiding a race between the two herds.
                    wildPoints.put(key, distance);
                }

                int index = jumpIndex(x);
                point = normalized.add(jumpPoints[index]);
                distance = distance.add(jumps[index]);
                countJump();
            }
        } catch (Throwable t) {
            setWorkerError("Wild " + (workerId + 1), t);
        }
    }

    private boolean testCandidate(
            BigInteger candidate,
            ECPoint generator,
            ECPoint target
    ) {
        if (candidate.compareTo(RANGE_START) < 0 ||
                candidate.compareTo(RANGE_END) > 0) {
            return false;
        }

        ECPoint check = generator.multiply(candidate).normalize();
        if (!check.equals(target)) return false;

        String found = to64Hex(candidate);
        if (foundHex.compareAndSet(null, found)) {
            running.set(false);
        }
        return true;
    }

    private BigInteger initialWildOffset(int workerId) {
        // Small, distinct randomized offsets let several wild kangaroos search
        // independently without moving them across the entire 2^139 interval.
        BigInteger spacing = BigInteger.ONE.shiftLeft(64);
        BigInteger base = spacing.multiply(BigInteger.valueOf(workerId));

        byte[] salt = new byte[16];
        secureRandom.nextBytes(salt);
        BigInteger jitter = new BigInteger(1, salt)
                .xor(BigInteger.valueOf(runNonce))
                .mod(spacing);

        return base.add(jitter);
    }

    private BigInteger[] buildJumpScalars() throws Exception {
        BigInteger[] jumps = new BigInteger[JUMP_COUNT];
        BigInteger floor = BigInteger.ONE.shiftLeft(66);
        BigInteger span = BigInteger.ONE.shiftLeft(69)
                .subtract(floor);

        MessageDigest digest = MessageDigest.getInstance("SHA-256");

        for (int i = 0; i < JUMP_COUNT; i++) {
            byte[] seed =
                    ("btc-puzzle-140-jump-" + i)
                            .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            BigInteger r =
                    new BigInteger(1, digest.digest(seed)).mod(span);
            jumps[i] = floor.add(r);
        }

        return jumps;
    }

    private int jumpIndex(BigInteger affineX) {
        return affineX.intValue() & (JUMP_COUNT - 1);
    }

    private boolean isDistinguished(BigInteger affineX) {
        return affineX.and(DP_MASK).signum() == 0;
    }

    private String pointKey(ECPoint point) {
        return bytesToHex(point.getEncoded(true));
    }

    private void countJump() {
        sessionCounter.incrementAndGet();
        totalCounter.incrementAndGet();
    }

    private void setWorkerError(String worker, Throwable t) {
        if (lastError == null || lastError.isEmpty()) {
            lastError =
                    worker + ": " +
                    t.getClass().getSimpleName() + ": " +
                    String.valueOf(t.getMessage());
        }
        running.set(false);
    }

    private synchronized void saveCounters() {
        prefs.edit()
                .putLong(PREF_TOTAL, totalCounter.get())
                .apply();
    }

    public static double expectedWorkJumps() {
        return Math.pow(2.0, 69.5);
    }

    // Legacy bridge method. For Kangaroo this is "work performed compared with
    // the square-root work estimate", not literal keyspace coverage.
    public static double fractionOfFullRange(long checked) {
        if (checked <= 0) return 0.0;
        return Math.min(1.0, checked / expectedWorkJumps());
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
        String h = value.toString(16).toLowerCase(Locale.US);
        StringBuilder out = new StringBuilder(64);
        for (int i = h.length(); i < 64; i++) out.append('0');
        out.append(h);
        return out.toString();
    }

    private static byte[] hexToBytes(String hex) {
        int len = hex.length();
        byte[] out = new byte[len / 2];

        for (int i = 0; i < len; i += 2) {
            out[i / 2] =
                    (byte) Integer.parseInt(hex.substring(i, i + 2), 16);
        }

        return out;
    }

    private static String bytesToHex(byte[] bytes) {
        final char[] chars = "0123456789abcdef".toCharArray();
        char[] out = new char[bytes.length * 2];

        for (int i = 0; i < bytes.length; i++) {
            int v = bytes[i] & 0xff;
            out[i * 2] = chars[v >>> 4];
            out[i * 2 + 1] = chars[v & 0x0f];
        }

        return new String(out);
    }
}
