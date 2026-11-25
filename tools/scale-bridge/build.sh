#!/bin/sh
# Builds RideframeScaleBridge.app next to this script: one Swift file, CoreBluetooth only, no Xcode project, no packages.
# Needs the Command Line Tools (xcode-select --install). Usage: ./build.sh  [then: open RideframeScaleBridge.app --args --scan --out ~/scale-scan.jsonl]
set -e
cd "$(dirname "$0")"
APP=RideframeScaleBridge.app
ARCH=$(uname -m)
mkdir -p "$APP/Contents/MacOS"
cp Info.plist "$APP/Contents/Info.plist"
# the Info.plist also goes INTO the binary, so the Bluetooth question names the bridge even when the binary is started on its own
swiftc -O -swift-version 5 -target "$ARCH-apple-macos12" main.swift -o "$APP/Contents/MacOS/scale-bridge" -framework CoreBluetooth \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist
# ad-hoc signature (no developer account needed). A rebuild changes it, and macOS may ask for Bluetooth again: rebuild only when needed.
codesign --force --sign - --identifier com.rideframe.scale-bridge "$APP"
echo "built $(pwd)/$APP"
