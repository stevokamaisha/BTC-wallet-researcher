#!/usr/bin/env python3
"""Genesis puzzle clue pass B: exhaustive CUT ranges on the two strongest fields.

Hard-coded public target only.  It follows the newest public recipe:
bitcoin-cli -> jq -> cut -> tr -> sha256sum -> first 32 hex -> BIP39
and tests the natural BIP48 native-P2WSH interpretation.

Scope:
* source fields: genesis coinbase scriptSig hex and full raw coinbase tx hex
* every contiguous character range (GNU cut -c style)
* tr-style case normalization and newline/no-newline variants
* BIP39 passphrase: exact historical name "Hal Finney"
* BIP48 account: Genesis nonce 2083236893
* 2-of-2 interpretations:
    - one root, child 0/0 with 0/1
    - one root, child 0/0 with 1/0
    - separate roots from different tr variants of the same CUT range
"""
from __future__ import annotations
import hashlib, json, multiprocessing as mp, os, time
from bip_utils import Bip32Slip10Secp256k1, Bip39Languages, Bip39MnemonicGenerator, Bip39SeedGenerator

TARGET=bytes.fromhex("4dae67a9872f1402109f9670276afc2c0758f895aafddcd089795771b7964833")
PASSPHRASE="Hal Finney"
ACCOUNT=2083236893

GENESIS_HEX=(
"0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e"
"67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c01010000000100000000000000000000"
"00000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f"
"4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f75742066"
"6f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a6"
"7962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000")
RAW=bytes.fromhex(GENESIS_HEX)
TX=RAW[81:]
SCRIPT_SIG=TX[42:42+77]
BASES={
    "coinbase_scriptsig_hex": SCRIPT_SIG.hex(),
    "raw_coinbase_tx_hex": TX.hex(),
}

GEN=Bip39MnemonicGenerator(Bip39Languages.ENGLISH)

def wp(a,b):
    return hashlib.sha256(b"\x52\x21"+a+b"\x21"+b+b"\x52\xae").digest()

def derive(source):
    entropy=hashlib.sha256(source.encode()).digest()[:16]
    mn=str(GEN.FromEntropy(entropy))
    seed=Bip39SeedGenerator(mn,Bip39Languages.ENGLISH).Generate(PASSPHRASE)
    root=Bip32Slip10Secp256k1.FromSeed(seed)
    acct=root.DerivePath(f"m/48'/0'/{ACCOUNT}'/2'")
    p00=acct.DerivePath("0/0").PublicKey().RawCompressed().ToBytes()
    p01=acct.DerivePath("0/1").PublicKey().RawCompressed().ToBytes()
    p10=acct.DerivePath("1/0").PublicKey().RawCompressed().ToBytes()
    return mn,p00,p01,p10

def forms(s):
    # tr commonly removes the command newline or changes character case.
    vals=[("raw",s),("raw_nl",s+"\n"),("upper",s.upper()),("upper_nl",s.upper()+"\n")]
    seen=set()
    out=[]
    for n,v in vals:
        if v not in seen:
            seen.add(v); out.append((n,v))
    return out

def work(task):
    base_name, value, start = task
    hits=[]; roots=0; orders=0
    n=len(value)
    for end in range(start+1,n+1):
        cut=value[start:end]
        derived=[]
        for form_name,src in forms(cut):
            try:
                mn,p00,p01,p10=derive(src)
            except Exception:
                continue
            roots += 1
            meta={"base":base_name,"cut_start_1based":start+1,"cut_end_1based":end,
                  "form":form_name,"source":src.rstrip("\n"),"mnemonic":mn,
                  "passphrase":PASSPHRASE,"account":ACCOUNT}
            for model,b in (("same_root_00_01",p01),("same_root_00_10",p10)):
                orders += 2
                if wp(p00,b)==TARGET or wp(b,p00)==TARGET:
                    hits.append({**meta,"model":model,"pubA":p00.hex(),"pubB":b.hex()})
            derived.append((form_name,src,mn,p00))
        # Two-root interpretation, but only between tr/newline variants of
        # the exact same contiguous cut range.
        for i in range(len(derived)):
            for j in range(i+1,len(derived)):
                a,b=derived[i],derived[j]
                orders += 2
                if wp(a[3],b[3])==TARGET or wp(b[3],a[3])==TARGET:
                    hits.append({"base":base_name,"cut_start_1based":start+1,
                      "cut_end_1based":end,"model":"two_roots_same_cut",
                      "A":{"form":a[0],"source":a[1].rstrip("\n"),"mnemonic":a[2],"pub":a[3].hex()},
                      "B":{"form":b[0],"source":b[1].rstrip("\n"),"mnemonic":b[2],"pub":b[3].hex()},
                      "passphrase":PASSPHRASE,"account":ACCOUNT})
    return roots,orders,hits

def main():
    tasks=[]
    for name,val in BASES.items():
        for start in range(len(val)):
            tasks.append((name,val,start))
    workers=max(1,min(2,os.cpu_count() or 1))
    t0=time.time(); roots=orders=0; hits=[]
    with mp.Pool(workers) as pool:
        for i,(r,o,h) in enumerate(pool.imap_unordered(work,tasks,chunksize=1),1):
            roots+=r; orders+=o; hits.extend(h)
            if i%100==0:
                print(f"progress {i}/{len(tasks)} starts roots={roots:,} orders={orders:,}",flush=True)
    result={"target":TARGET.hex(),"scope":"pass_b_exhaustive_cut_two_fields",
            "passphrase":PASSPHRASE,"account":ACCOUNT,
            "tested_derived_roots":roots,"tested_script_orders":orders,
            "seconds":time.time()-t0,"hits":hits}
    with open("genesis-pass-b-results.json","w") as f: json.dump(result,f,indent=2)
    print(json.dumps({k:result[k] for k in ["tested_derived_roots","tested_script_orders","seconds"]},indent=2))
    print("MATCH FOUND" if hits else "NO MATCH IN PASS B")
    if hits: print(json.dumps(hits,indent=2))

if __name__=="__main__":
    main()
