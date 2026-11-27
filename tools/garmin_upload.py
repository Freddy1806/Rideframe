#!/usr/bin/env python3
"""RIDEFRAME -> Garmin Connect, step 2 of 2 (owner 27.11.: by our own script, no paid third party).

Uploads the .tcx files tools/garmin-export.mjs wrote. Runs on the host only, in its own venv with the package `garminconnect`
(unofficial: Garmin has no public upload API for private users, so this can break when Garmin changes its login).

  python garmin_upload.py --login            once, by the owner at the Mac: asks for e-mail, password and the MFA code in the
                                             terminal and keeps only Garmin's session tokens in <dir>/tokens (mode 700).
                                             The password is never written anywhere.
  python garmin_upload.py --user <account>   the regular run: export new rides, upload them, move them to <dir>/sent.

<dir> is the folder of this venv (default ~/RIDEFRAME_garmin_sync), files wait in <dir>/out. One line per run in <dir>/sync.log:
counts and reasons only, never a name, a token or a password. Exit 0 also when there was nothing to do; 4 = sign in again.
"""
import argparse, datetime, getpass, os, shutil, subprocess, sys
from pathlib import Path


def log(base: Path, text: str) -> None:
    line = f"{datetime.datetime.now().isoformat(timespec='seconds')} {text}"
    print(line)
    with open(base / "sync.log", "a", encoding="utf-8") as f:
        f.write(line + "\n")


def client(tokens: Path):
    from garminconnect import Garmin  # imported late: --help works without the package
    g = Garmin()
    g.login(str(tokens))  # tokens only (garminconnect 0.3.x keeps them in <tokens>/garmin_tokens.json and refreshes them itself); raises without usable ones
    return g


def do_login(base: Path, tokens: Path) -> int:
    from garminconnect import Garmin
    email = input("Garmin e-mail: ").strip()
    pw = getpass.getpass("Garmin password (not shown, not stored): ")
    tokens.mkdir(parents=True, exist_ok=True)
    os.chmod(tokens, 0o700)
    def code() -> str:  # the 6 digits Garmin sends now; anything else (a password typed by habit) is asked again and never echoed back
        while True:
            c = input("6-digit code Garmin just sent you (e-mail or SMS, digits only): ").strip().replace(" ", "")
            if c.isdigit() and 4 <= len(c) <= 8:
                return c
            print("That is not the code. Look in your mail for the message from Garmin and type its digits.")
    g = Garmin(email=email, password=pw, prompt_mfa=code)
    try:
        g.login(str(tokens))
    except Exception as e:
        log(base, f"login failed ({type(e).__name__}): wrong password or code, or Garmin refused. Run --login again."); return 4
    g.client.dump(str(tokens))  # the library saves by itself but stays silent when that fails: once more, loudly
    if not any(tokens.iterdir()):
        log(base, "login worked but no token file was written"); return 6
    log(base, "login ok, tokens saved")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(Path.home() / "RIDEFRAME_garmin_sync"))
    ap.add_argument("--login", action="store_true")
    ap.add_argument("--user", help="RIDEFRAME account name whose rides go to Garmin")
    ap.add_argument("--repo", default=str(Path(__file__).resolve().parent.parent), help="the RIDEFRAME folder with tools/garmin-export.mjs")
    ap.add_argument("--since", help="YYYY-MM-DD: also send older rides from that day on (once)")
    ap.add_argument("--dry", action="store_true", help="export and list, upload nothing")
    a = ap.parse_args()
    base = Path(a.dir); base.mkdir(parents=True, exist_ok=True)
    tokens, out, sent = base / "tokens", base / "out", base / "sent"
    if a.login:
        return do_login(base, tokens)
    if not a.user:
        ap.error("--user is needed")
    cmd = ["node", str(Path(a.repo) / "tools" / "garmin-export.mjs"), "--user", a.user, "--out", str(out)] + (["--since", a.since] if a.since else [])
    ex = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if ex.returncode != 0:
        log(base, f"export failed ({ex.returncode})"); return 3
    files = sorted(out.glob("*.tcx"))
    if not files:
        log(base, "nothing new"); return 0
    if a.dry:
        log(base, f"dry run: {len(files)} file(s) waiting"); return 0
    try:
        g = client(tokens)
    except Exception as e:  # no tokens, expired, Garmin changed something
        log(base, f"sign in again needed ({type(e).__name__}); {len(files)} file(s) waiting"); return 4
    sent.mkdir(exist_ok=True)
    ok = dup = bad = 0
    for f in files:
        try:
            g.upload_activity(str(f)); ok += 1
        except Exception as e:
            if getattr(getattr(e, "response", None), "status_code", None) == 409 or "API Error 409" in str(e):
                dup += 1  # Garmin has it already: done as well
            else:
                bad += 1; log(base, f"upload failed ({type(e).__name__}): file stays for the next run"); continue
        shutil.move(str(f), str(sent / f.name))
    log(base, f"uploaded {ok}, already there {dup}, failed {bad}")
    return 0 if not bad else 5


if __name__ == "__main__":
    sys.exit(main())
