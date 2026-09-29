package com.stevo.btcwalletresearcher;

import org.bouncycastle.asn1.x9.X9ECParameters;
import org.bouncycastle.crypto.ec.CustomNamedCurves;
import org.bouncycastle.math.ec.ECPoint;

import java.math.BigInteger;

/**
 * Small, fixed known-answer laboratory for the symmetry/collision equations
 * used by SOTA-style Pollard Kangaroo methods.
 *
 * This never accepts an external target and never searches a real wallet.
 * It exists only to validate the algebra before any change is allowed into
 * the fixed public Puzzle #140 engine.
 */
public final class KangarooSotaLab {
    private KangarooSotaLab() {}

    public static boolean selfTest() {
        try {
            X9ECParameters params = CustomNamedCurves.getByName("secp256k1");
            if (params == null) return false;

            ECPoint g = params.getG().normalize();

            // Keep the synthetic secret even so the wild distances can also
            // be even, matching the SOTA-v2 invariant used in the reference.
            BigInteger secret = BigInteger.valueOf(12346L);
            ECPoint q = g.multiply(secret).normalize();

            if (!testDirectTameWild(g, q, secret)) return false;
            if (!testMirroredTameWild(g, q, secret)) return false;
            if (!testMirroredWildWild(g, q, secret)) return false;
            if (!testXCoordinateSymmetry(q)) return false;

            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static boolean testDirectTameWild(
            ECPoint g,
            ECPoint q,
            BigInteger secret
    ) {
        // Wild invariant: W = -Q + wG = (w-k)G.
        BigInteger w = BigInteger.valueOf(20000L);
        BigInteger t = w.subtract(secret);

        ECPoint tame = g.multiply(t).normalize();
        ECPoint wild = g.multiply(w).subtract(q).normalize();
        if (!tame.equals(wild)) return false;

        // Direct SOTA tame/wild collision gives ±(t-w) = k.
        BigInteger candidate = t.subtract(w).abs();
        return candidate.equals(secret)
                && g.multiply(candidate).normalize().equals(q);
    }

    private static boolean testMirroredTameWild(
            ECPoint g,
            ECPoint q,
            BigInteger secret
    ) {
        // Construct T = -W, so matching by affine x still detects it.
        BigInteger w = BigInteger.valueOf(5000L);
        BigInteger t = secret.subtract(w);

        ECPoint tame = g.multiply(t).normalize();
        ECPoint wild = g.multiply(w).subtract(q).normalize();
        if (!sameAffineX(tame, wild)) return false;
        if (tame.equals(wild)) return false;

        // Mirrored branch corresponds to negating the tame distance first:
        // |-t - w| = k.
        BigInteger candidate = t.negate().subtract(w).abs();
        return candidate.equals(secret)
                && g.multiply(candidate).normalize().equals(q);
    }

    private static boolean testMirroredWildWild(
            ECPoint g,
            ECPoint q,
            BigInteger secret
    ) {
        // W1 = (d1-k)G and W2 = (d2-k)G.
        // Choose d1+d2=2k, giving W1=-W2, hence identical affine x.
        BigInteger d1 = BigInteger.valueOf(20000L);
        BigInteger d2 = secret.shiftLeft(1).subtract(d1);

        if (d1.testBit(0) || d2.testBit(0)) return false;

        ECPoint w1 = g.multiply(d1).subtract(q).normalize();
        ECPoint w2 = g.multiply(d2).subtract(q).normalize();

        if (!sameAffineX(w1, w2)) return false;
        if (w1.equals(w2)) return false;

        BigInteger sum = d1.add(d2);
        if (sum.testBit(0)) return false;

        // Mirrored same-wild collision: k=(d1+d2)/2.
        BigInteger candidate = sum.shiftRight(1);
        return candidate.equals(secret)
                && g.multiply(candidate).normalize().equals(q);
    }

    private static boolean testXCoordinateSymmetry(ECPoint point) {
        ECPoint p = point.normalize();
        ECPoint neg = p.negate().normalize();

        return sameAffineX(p, neg)
                && !p.equals(neg)
                && !java.util.Arrays.equals(p.getEncoded(true), neg.getEncoded(true));
    }

    private static boolean sameAffineX(ECPoint a, ECPoint b) {
        return a.normalize().getAffineXCoord().toBigInteger()
                .equals(b.normalize().getAffineXCoord().toBigInteger());
    }
}
