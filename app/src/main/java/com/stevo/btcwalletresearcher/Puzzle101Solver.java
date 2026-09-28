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

public final class Puzzle101Solver {
    public static final String TARGET_ADDRESS = "1CKCVdbDJasYmhswB6HKZHEAnNaDpK7W4n";
    public static final String RANGE_START_HEX = "10000000000000000000000000";
    public static final String RANGE_END_HEX = "1fffffffffffffffffffffffff";
    public static final String TARGET_HASH160_HEX = "7c1a77205c03b9909663b2034faa0b544e6bc96b";

    private static final BigInteger RANGE_START = new BigInteger(RANGE_START_HEX, 16);
    private static final BigInteger RANGE_END = new BigInteger(RANGE_END_HEX, 16);
    private static final BigInteger RANGE_SIZE = BigInteger.ONE.shiftLeft(100);
    private static final BigInteger ONE = BigInteger.ONE;
    private static final int EC_BATCH = 256;

    private static final String PREFS = "puzzle101_solver";
    private static final String PREF_CURRENT = "current_hex";
    private static final String PREF_TOTAL = "total_checked";

    private final SharedPreferences prefs;
    private final SecureRandom secureRandom = new SecureRandom();
    private final AtomicBoolean running = new AtomicBoolean(false);

    private volatile Thread worker;
    private volatile BigInteger currentKey;
    private volatile long totalChecked;
    private volatile long sessionChecked;
    private volatile double lastSpeed;
    private volatile String lastError = "";

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

        State(boolean running, String currentHex, long sessionChecked, long totalChecked, double keysPerSecond, String error) {
            this.running = running;
            this.currentHex = currentHex;
            this.sessionChecked = sessionChecked;
            this.totalChecked = totalChecked;
            this.keysPerSecond = keysPerSecond;
            this.error = error == null ? "" : error;
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
        totalChecked = prefs.getLong(PREF_TOTAL, 0L);
    }

    public synchronized void start(Listener listener) {
        if (running.get()) {
            listener.onState(snapshot());
            return;
        }

        running.set(true);
        sessionChecked = 0L;
        lastSpeed = 0.0;
        lastError = "";

        if (listener != null) listener.onState(snapshot());

        worker = new Thread(() -> runSolver(listener), "Puzzle101Solver");
        worker.setPriority(Thread.NORM_PRIORITY);
        worker.start();
    }

    public synchronized void stop(Listener listener) {
        running.set(false);
        saveCheckpoint();
        if (listener != null) listener.onState(snapshot());
    }

    public synchronized State newRandomShard() {
        running.set(false);
        BigInteger offset = new BigInteger(100, secureRandom);
        currentKey = RANGE_START.add(offset);
        sessionChecked = 0L;
        lastSpeed = 0.0;
        lastError = "";
        saveCheckpoint();
        return snapshot();
    }

    public synchronized State resetToRangeStart() {
        running.set(false);
        currentKey = RANGE_START;
        sessionChecked = 0L;
        totalChecked = 0L;
        lastSpeed = 0.0;
        lastError = "";
        saveCheckpoint();
        return snapshot();
    }

    public State snapshot() {
        return new State(
                running.get(),
                to64Hex(currentKey),
                sessionChecked,
                totalChecked,
                lastSpeed,
                lastError
        );
    }

    public boolean selfTest() {
        try {
            lastError = "";
            X9ECParameters params = CustomNamedCurves.getByName("secp256k1");
            if (params == null) return false;
            byte[] pub = params.getG().multiply(BigInteger.ONE).normalize().getEncoded(true);
            byte[] actual = hash160(pub);
            byte[] expected = hexToBytes("751e76e8199196d454941c45d1b3a323f1433bd6");
            return Arrays.equals(actual, expected);
        } catch (Exception e) {
            return false;
        }
    }

    private void runSolver(Listener listener) {
        try {
            X9ECParameters params = CustomNamedCurves.getByName("secp256k1");
            if (params == null) throw new IllegalStateException("secp256k1 is unavailable.");

            ECPoint generator = params.getG();
            BigInteger key = currentKey;
            ECPoint point = generator.multiply(key);

            byte[] targetHash160 = hexToBytes(TARGET_HASH160_HEX);
            MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
            RIPEMD160Digest ripemd = new RIPEMD160Digest();

            long reportStarted = System.nanoTime();
            long reportChecked = 0L;
            long checkpointAt = System.nanoTime();

            listener.onState(snapshot());

            while (running.get() && key.compareTo(RANGE_END) <= 0) {
                BigInteger remaining = RANGE_END.subtract(key).add(ONE);
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
                    currentKey = candidate;

                    byte[] compressedPublicKey = points[i].getEncoded(true);
                    byte[] sha = sha256.digest(compressedPublicKey);
                    ripemd.update(sha, 0, sha.length);
                    byte[] candidateHash160 = new byte[20];
                    ripemd.doFinal(candidateHash160, 0);

                    if (Arrays.equals(candidateHash160, targetHash160)) {
                        currentKey = candidate;
                        running.set(false);
                        saveCheckpoint();
                        listener.onFound(snapshot(), to64Hex(candidate));
                        return;
                    }

                    processed++;
                    sessionChecked++;
                    totalChecked++;
                    reportChecked++;

                    long now = System.nanoTime();

                    if (now - reportStarted >= 1_000_000_000L) {
                        double seconds = (now - reportStarted) / 1_000_000_000.0;
                        lastSpeed = reportChecked / Math.max(0.001, seconds);
                        reportStarted = now;
                        reportChecked = 0L;
                        listener.onState(snapshot());
                    }

                    if (now - checkpointAt >= 4_000_000_000L) {
                        currentKey = candidate.add(ONE);
                        saveCheckpoint();
                        currentKey = candidate;
                        checkpointAt = now;
                    }
                }

                key = key.add(BigInteger.valueOf(processed));
                currentKey = key;

                if (processed == count) {
                    point = nextPoint;
                } else if (key.compareTo(RANGE_END) <= 0) {
                    point = generator.multiply(key);
                }
            }

            if (key.compareTo(RANGE_END) > 0) {
                currentKey = RANGE_END;
            }
        } catch (Throwable t) {
            running.set(false);
            lastError = t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
            if (listener != null) listener.onError(lastError);
        } finally {
            saveCheckpoint();
            running.set(false);
            if (listener != null) listener.onState(snapshot());
        }
    }

    private synchronized void saveCheckpoint() {
        prefs.edit()
                .putString(PREF_CURRENT, to64Hex(currentKey))
                .putLong(PREF_TOTAL, totalChecked)
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
