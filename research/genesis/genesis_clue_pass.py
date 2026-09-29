#!/usr/bin/env python3
"""Hard-coded clue pass for the public Genesis Block Wallet Puzzle.

This is intentionally NOT a general wallet/key cracker. It only tests the public
Genesis puzzle target and a bounded set of transformations implied by the
author's September 2026 hints.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import re
from dataclasses import dataclass

from bip_utils import Bip32Slip10Secp256k1, Bip39Languages, Bip39MnemonicGenerator, Bip39SeedGenerator

TARGET = bytes.fromhex("4dae67a9872f1402109f9670276afc2c0758f895aafddcd089795771b7964833")

GENESIS_HEX = (
    "0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e"
    "67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c01010000000100000000000000000000"
    "00000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f"
    "4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f75742066"
    "6f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a6"
    "7962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000"
)
RAW = bytes.fromhex(GENESIS_HEX)
HEADER = RAW[:80]
TX = RAW[81:]  # one-byte tx-count follows the 80-byte header
SCRIPT_SIG = TX[42:42+77]
COINBASE_TEXT = SCRIPT_SIG[8:].decode("ascii")
HEADLINE = "Chancellor on brink of second bailout for banks"
MERKLE_LE = HEADER[36:68]
MERKLE_BE = MERKLE_LE[::-1]
BLOCK_HASH_BE = hashlib.sha256(hashlib.sha256(HEADER).digest()).digest()[::-1]
PUBKEY = TX[-70:-5]
SCRIPT_PUBKEY = bytes([65]) + PUBKEY + bytes([0xAC])

TIME = int.from_bytes(HEADER[68:72], "little")
BITS = int.from_bytes(HEADER[72:76], "little")
NONCE = int.from_bytes(HEADER[76:80], "little")

BASES = {
    "raw_block_hex": GENESIS_HEX,
    "header_hex": HEADER.hex(),
    "raw_coinbase_tx_hex": TX.hex(),
    "coinbase_scriptsig_hex": SCRIPT_SIG.hex(),
    "coinbase_text": COINBASE_TEXT,
    "headline": HEADLINE,
    "merkle_be_hex": MERKLE_BE.hex(),
    "merkle_le_hex": MERKLE_LE.hex(),
    "block_hash_hex": BLOCK_HASH_BE.hex(),
    "coinbase_pubkey_hex": PUBKEY.hex(),
    "scriptpubkey_hex": SCRIPT_PUBKEY.hex(),
    "time_decimal": str(TIME),
    "bits_decimal": str(BITS),
    "nonce_decimal": str(NONCE),
    "bits_hex": f"{BITS:08x}",
    "nonce_hex": f"{NONCE:08x}",
}

PASSPHRASES = [
    "Hal Finney", "hal finney", "HAL FINNEY",
    "HalFinney", "halfinney", "HALFINNEY",
    "Hal", "hal", "HAL", "halfin", "Halfin",
    "Harold Finney", "harold finney",
    "Harold Thomas Finney II", "harold thomas finney ii",
    "Hal_Finney", "hal_finney", "Hal-Finney", "hal-finney",
]

# BIP48 account must be < 2^31. These are direct, public Genesis values
# plus tiny natural constants mentioned in the puzzle/research.
ACCOUNTS = [NONCE, TIME, BITS, 0, 1, 2, 50, 69, 77, 80, 285, 2009]

CUT_LENGTHS = [1,2,3,4,8,16,20,24,28,32,40,47,64,69,77,80,96,128,154,160,256,285]

def pieces(label: str, value: str):
    seen = set()
    def add(name, s):
        if s and s not in seen:
            seen.add(s)
            yield (name, s)
    yield from add("full", value)
    if len(value) > 1:
        yield from add("cut_c2_end", value[1:])
        yield from add("drop_last", value[:-1])
    mid = len(value)//2
    if mid:
        yield from add("first_half", value[:mid])
        yield from add("second_half", value[mid:])
    for n in CUT_LENGTHS:
        if n <= len(value):
            yield from add(f"prefix_{n}", value[:n])
            yield from add(f"suffix_{n}", value[-n:])

def transforms(s: str):
    vals = [
        ("raw", s),
        ("lower", s.lower()),
        ("upper", s.upper()),
        ("no_spaces", s.replace(" ", "")),
        ("no_ws", re.sub(r"\s+", "", s)),
        ("alnum", re.sub(r"[^A-Za-z0-9]", "", s)),
        ("reverse", s[::-1]),
        ("ucfirst", s[:1].upper()+s[1:]),
        ("lcfirst", s[:1].lower()+s[1:]),
    ]
    out=[]; seen=set()
    for name,v in vals:
        if v and v not in seen:
            seen.add(v); out.append((name,v))
    return out

def mnemonic_from_text(text: str) -> str:
    # Latest clue: first 32 HEX chars of sha256sum were used as raw
    # 128-bit BIP39 entropy.
    ent = hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]
    m = Bip39MnemonicGenerator(Bip39Languages.ENGLISH).FromEntropy(bytes.fromhex(ent))
    return str(m)

def pub_at(seed: bytes, account: int, branch: int, index: int) -> bytes:
    root = Bip32Slip10Secp256k1.FromSeed(seed)
    node = root.DerivePath(f"m/48'/0'/{account}'/2'/{branch}/{index}")
    return node.PublicKey().RawCompressed().ToBytes()

def witness_program(a: bytes, b: bytes) -> bytes:
    script = b"\x52\x21" + a + b"\x21" + b + b"\x52\xae"
    return hashlib.sha256(script).digest()

@dataclass
class Cand:
    base: str
    piece: str
    transform: str
    source: str
    mnemonic: str
    passphrase: str
    account: int
    pub00: bytes
    pub01: bytes
    pub10: bytes

def main():
    tested_roots = 0
    tested_pairs = 0
    hits = []
    summary = {}

    for base_name, base_value in BASES.items():
        root_specs = []
        for piece_name, piece_value in pieces(base_name, base_value):
            for tr_name, source in transforms(piece_value):
                mnemonic = mnemonic_from_text(source)
                for passphrase in PASSPHRASES:
                    seed = Bip39SeedGenerator(mnemonic, Bip39Languages.ENGLISH).Generate(passphrase)
                    for account in ACCOUNTS:
                        try:
                            c = Cand(
                                base_name, piece_name, tr_name, source, mnemonic, passphrase, account,
                                pub_at(seed, account, 0, 0),
                                pub_at(seed, account, 0, 1),
                                pub_at(seed, account, 1, 0),
                            )
                        except Exception:
                            continue
                        root_specs.append(c)
                        tested_roots += 1

                        # One-root interpretations: two independent child keys.
                        for pair_name, a, b in [
                            ("same_root_00_01", c.pub00, c.pub01),
                            ("same_root_00_10", c.pub00, c.pub10),
                        ]:
                            tested_pairs += 2
                            if witness_program(a,b) == TARGET or witness_program(b,a) == TARGET:
                                hits.append({"model": pair_name, **c.__dict__, "pub00":a.hex(), "pubB":b.hex()})

        # Two-root interpretation: same underlying Genesis field, separate
        # transformed/cut roots. Keep passphrase+account equal, as the clues imply.
        buckets = {}
        for c in root_specs:
            buckets.setdefault((c.passphrase, c.account), []).append(c)
        for (pp, acc), group in buckets.items():
            # Deduplicate identical pubkeys produced by equivalent transforms.
            uniq = {}
            for c in group:
                uniq.setdefault(c.pub00, c)
            arr = list(uniq.values())
            for i in range(len(arr)):
                a = arr[i]
                for j in range(i+1, len(arr)):
                    b = arr[j]
                    tested_pairs += 2
                    if witness_program(a.pub00,b.pub00) == TARGET or witness_program(b.pub00,a.pub00) == TARGET:
                        hits.append({
                            "model":"two_roots_same_field",
                            "base":base_name,"passphrase":pp,"account":acc,
                            "A":{"piece":a.piece,"transform":a.transform,"source":a.source,"mnemonic":a.mnemonic,"pub":a.pub00.hex()},
                            "B":{"piece":b.piece,"transform":b.transform,"source":b.source,"mnemonic":b.mnemonic,"pub":b.pub00.hex()},
                        })
        summary[base_name] = {"derived_records": len(root_specs)}

    result = {
        "target": TARGET.hex(),
        "tested_derived_records": tested_roots,
        "tested_script_orders": tested_pairs,
        "hits": hits,
        "bases": summary,
    }
    with open("genesis-pass-a-results.json","w",encoding="utf-8") as f:
        json.dump(result,f,indent=2,ensure_ascii=False)
    print(json.dumps({
        "tested_derived_records": tested_roots,
        "tested_script_orders": tested_pairs,
        "hits": len(hits),
    }, indent=2))
    if hits:
        print("MATCH FOUND")
        print(json.dumps(hits, indent=2, ensure_ascii=False))
    else:
        print("NO MATCH IN PASS A")

if __name__ == "__main__":
    main()
