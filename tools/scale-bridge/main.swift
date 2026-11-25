// RIDEFRAME scale bridge (25.11.): runs on the Mac mini next to serve.mjs, listens for eufy smart scales over Bluetooth LE and
// forwards what it hears RAW to the local server (POST /api/scale/frame). All decoding lives in tools/scale-decode.mjs, so a wrong
// offset is fixed on the server without rebuilding this program. It only scans, connects when the server asks, subscribes to
// notifications, writes what the server answers, and reads the battery level. Build: ./build.sh (swiftc, no Xcode, no packages).
//
//   scale-bridge                     run: forward eufy advertisements (only when they change, else every 30 s) to the server
//   scale-bridge --scan              print every advertisement of candidate devices as one JSON line (hex), no server needed
//   scale-bridge --scan-all          the same for EVERY Bluetooth LE device around (to find a scale that names itself differently)
//   scale-bridge --replay file.jsonl post recorded lines (from --scan or --record) to the server, gaps kept (at most 6 s)
//   options: --server http://127.0.0.1:8765  --data ~/RIDEFRAME_data (holds scale-bridge.secret)  --record file.jsonl
//            --out file (write the --scan lines there instead of stdout)  -v (verbose log on stderr)
import Foundation
import CoreBluetooth

let VERSION = "1.0"
var args = Array(CommandLine.arguments.dropFirst())
func opt(_ name: String) -> String? { if let i = args.firstIndex(of: name), i + 1 < args.count { return args[i + 1] }; return nil }
func flag(_ name: String) -> Bool { return args.contains(name) }
let scanOnly = flag("--scan") || flag("--scan-all"), scanAll = flag("--scan-all"), verbose = flag("-v") || flag("--verbose")
let server = opt("--server") ?? ProcessInfo.processInfo.environment["RIDEFRAME_URL"] ?? "http://127.0.0.1:8765"
let dataDir = opt("--data") ?? ProcessInfo.processInfo.environment["RIDEFRAME_DATA"] ?? (NSHomeDirectory() + "/RIDEFRAME_data")
let recordPath = opt("--record"), outPath = opt("--out"), replayPath = opt("--replay")

func stamp() -> String { let f = ISO8601DateFormatter(); return f.string(from: Date()) }
func log(_ s: String) { FileHandle.standardError.write((stamp() + " " + s + "\n").data(using: .utf8)!) }
func vlog(_ s: String) { if verbose { log(s) } }
func hex(_ d: Data) -> String { return d.map { String(format: "%02x", $0) }.joined() }
func unhex(_ s: String) -> Data { var d = Data(); var i = s.startIndex
  while i < s.endIndex, let j = s.index(i, offsetBy: 2, limitedBy: s.endIndex) { if let b = UInt8(s[i..<j], radix: 16) { d.append(b) }; i = j }; return d }
func appendLine(_ path: String, _ line: String) {
  let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
  if !FileManager.default.fileExists(atPath: url.path) { FileManager.default.createFile(atPath: url.path, contents: nil) }
  if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write((line + "\n").data(using: .utf8)!); h.closeFile() }
}
func jsonLine(_ o: [String: Any]) -> String { guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]) else { return "{}" }; return String(data: d, encoding: .utf8) ?? "{}" }

/* ---- the server ---- */
var secret = ""
func loadSecret() { secret = ((try? String(contentsOfFile: (dataDir as NSString).expandingTildeInPath + "/scale-bridge.secret", encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
let session: URLSession = { let c = URLSessionConfiguration.ephemeral; c.connectionProxyDictionary = [:]; c.timeoutIntervalForRequest = 8; return URLSession(configuration: c) }()
var serverOk = true
func post(_ body: [String: Any], _ done: (([String: Any]) -> Void)? = nil) {
  if secret.isEmpty { loadSecret() }
  guard let url = URL(string: server + "/api/scale/frame") else { return }
  var req = URLRequest(url: url); req.httpMethod = "POST"
  req.setValue("application/json", forHTTPHeaderField: "Content-Type"); req.setValue("Bearer " + secret, forHTTPHeaderField: "Authorization")
  var b = body; b["version"] = VERSION; req.httpBody = try? JSONSerialization.data(withJSONObject: b)
  session.dataTask(with: req) { data, resp, err in
    let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
    var j: [String: Any] = [:]; if let d = data, let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] { j = o }
    DispatchQueue.main.async {
      if code == 401 { loadSecret(); log("server says 401: is \(dataDir)/scale-bridge.secret the server's? (re-read)") }
      if code == 0 { if serverOk { log("server not reachable at \(server): \(err?.localizedDescription ?? "?") (keeps trying)") }; serverOk = false; return }
      if !serverOk { log("server reachable again"); serverOk = true }
      if code == 200 { done?(j) } else { vlog("server \(code): \(j)") }
    }
  }.resume()
}

/* ---- Bluetooth ---- */
final class Bridge: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  var central: CBCentralManager!
  var known: [UUID: CBPeripheral] = [:]          // strong references, CoreBluetooth needs them to connect
  var names: [UUID: String] = [:]                // the name arrives in the scan response, not with every advertisement
  var last: [UUID: (String, Date)] = [:]         // what was last forwarded, to send only changes (and every 30 s)
  var idle: [UUID: DispatchWorkItem] = [:]
  var pendingChars: [UUID: Int] = [:]

  override init() { super.init(); central = CBCentralManager(delegate: self, queue: nil) }

  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    switch c.state {
    case .poweredOn: log("Bluetooth on, scanning" + (scanOnly ? " (scan mode, nothing is sent)" : " for eufy scales")); startScan()
    case .unauthorized: log("Bluetooth NOT allowed for this program. System Settings > Privacy & Security > Bluetooth: allow \"RIDEFRAME Scale Bridge\" (or the Terminal you started it from), then start it again.")
    case .poweredOff: log("Bluetooth is off. Turn it on; scanning starts by itself.")
    case .unsupported: log("This Mac has no Bluetooth LE.")
    default: vlog("Bluetooth state \(c.state.rawValue)")
    }
  }
  func startScan() {
    central.stopScan()
    central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
  }

  func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData ad: [String: Any], rssi: NSNumber) {
    let id = p.identifier
    if let n = ad[CBAdvertisementDataLocalNameKey] as? String, !n.isEmpty { names[id] = n } else if let n = p.name, !n.isEmpty, names[id] == nil { names[id] = n }
    let name = names[id] ?? ""
    let mfr = (ad[CBAdvertisementDataManufacturerDataKey] as? Data) ?? Data()  // macOS: company id (2 bytes, little-endian) first
    let company = mfr.count >= 2 ? Int(mfr[mfr.startIndex]) | Int(mfr[mfr.startIndex + 1]) << 8 : -1
    let candidate = name.lowercased().hasPrefix("eufy") || company == 0xFF48
    if !candidate && !scanAll { return }
    known[id] = p
    var svc: [String: String] = [:]
    if let sd = ad[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data] { for (k, v) in sd { svc[k.uuidString] = hex(v) } }
    let uuids = ((ad[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID]) ?? []).map { $0.uuidString }
    let sig = hex(mfr) + "|" + name + "|" + svc.description
    let now = Date(), prev = last[id]
    if let pv = prev, pv.0 == sig, now.timeIntervalSince(pv.1) < 30 { return }   // unchanged: the scale repeats itself many times a second
    last[id] = (sig, now)
    var line: [String: Any] = ["kind": "adv", "id": id.uuidString, "name": name, "rssi": rssi.intValue, "mfr": hex(mfr), "at": Int(now.timeIntervalSince1970 * 1000)]
    if !svc.isEmpty { line["svc"] = svc }; if !uuids.isEmpty { line["uuids"] = uuids }
    if let cn = ad[CBAdvertisementDataIsConnectable] as? NSNumber { line["connectable"] = cn.boolValue }
    if scanOnly { let s = jsonLine(line); if let o = outPath { appendLine(o, s) } else { print(s); fflush(stdout) }; return }
    if let r = recordPath { appendLine(r, jsonLine(line)) }
    vlog("adv \(id.uuidString.prefix(8)) \(name) rssi \(rssi) \(hex(mfr))")
    post(line) { j in
      if (j["connect"] as? Bool) == true, p.state == .disconnected { log("connecting to \(name) (\(id.uuidString.prefix(8)))"); c.connect(p, options: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { if p.state == .connecting { log("connect timed out (the eufy app on a phone may hold the scale)"); c.cancelPeripheralConnection(p) } } }
    }
  }

  func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
    log("connected \(names[p.identifier] ?? "") (\(p.identifier.uuidString.prefix(8)))"); p.delegate = self; p.discoverServices(nil); touch(p)
  }
  func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) { log("connect failed: \(error?.localizedDescription ?? "?")") }
  func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
    log("disconnected (\(p.identifier.uuidString.prefix(8)))\(error != nil ? ": " + error!.localizedDescription : "")"); idle[p.identifier]?.cancel()
    if !scanOnly { post(["kind": "disconnected", "id": p.identifier.uuidString]) }
  }
  func touch(_ p: CBPeripheral) { // no notification for 90 s: let go of the scale, so the phone app can have it
    idle[p.identifier]?.cancel()
    let w = DispatchWorkItem { [weak self] in if p.state == .connected { log("idle, disconnecting"); self?.central.cancelPeripheralConnection(p) } }
    idle[p.identifier] = w; DispatchQueue.main.asyncAfter(deadline: .now() + 90, execute: w)
  }

  func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
    let s = p.services ?? []; pendingChars[p.identifier] = s.count
    if s.isEmpty { done(p) }
    for x in s { p.discoverCharacteristics(nil, for: x) }
  }
  func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    for ch in service.characteristics ?? [] {
      if ch.properties.contains(.notify) || ch.properties.contains(.indicate) { p.setNotifyValue(true, for: ch) }
      if ch.uuid == CBUUID(string: "2A19") { p.readValue(for: ch) }
    }
    pendingChars[p.identifier] = (pendingChars[p.identifier] ?? 1) - 1
    if pendingChars[p.identifier] == 0 { done(p) }
  }
  func done(_ p: CBPeripheral) { // every characteristic known: tell the server, it may answer with writes (the P2 handshake)
    let chars = (p.services ?? []).flatMap { $0.characteristics ?? [] }.map { $0.uuid.uuidString }
    vlog("characteristics: \(chars.joined(separator: " "))")
    post(["kind": "connected", "id": p.identifier.uuidString, "chars": chars]) { [weak self] j in self?.writes(p, j) }
  }
  func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
    guard let v = ch.value else { return }; touch(p)
    if ch.uuid == CBUUID(string: "2A19"), let b = v.first { post(["kind": "battery", "id": p.identifier.uuidString, "level": Int(b)]); return }
    let line: [String: Any] = ["kind": "notify", "id": p.identifier.uuidString, "char": ch.uuid.uuidString, "hex": hex(v), "at": Int(Date().timeIntervalSince1970 * 1000)]
    vlog("notify \(ch.uuid.uuidString) \(hex(v))"); if let r = recordPath { appendLine(r, jsonLine(line)) }
    post(line) { [weak self] j in self?.writes(p, j) }
  }
  /// the server's answer { write: [{ char, hex, delay }] }: written one after the other, delay ms before each
  func writes(_ p: CBPeripheral, _ j: [String: Any]) {
    guard let list = j["write"] as? [[String: Any]], !list.isEmpty else { return }
    var at = 0.0
    for w in list {
      let uuid = CBUUID(string: (w["char"] as? String) ?? ""), data = unhex((w["hex"] as? String) ?? "")
      at += Double((w["delay"] as? Int) ?? 0) / 1000
      DispatchQueue.main.asyncAfter(deadline: .now() + at) {
        guard p.state == .connected, let ch = (p.services ?? []).flatMap({ $0.characteristics ?? [] }).first(where: { $0.uuid == uuid }) else { log("write: no characteristic \(uuid.uuidString)"); return }
        let type: CBCharacteristicWriteType = ch.properties.contains(.write) ? .withResponse : .withoutResponse
        vlog("write \(uuid.uuidString) \(hex(data))"); p.writeValue(data, for: ch, type: type)
      }
    }
  }
}

/* ---- replay: post recorded lines with their gaps (at most 6 s), then wait for the server to settle the weigh-in ---- */
func replay(_ path: String) {
  guard let text = try? String(contentsOfFile: (path as NSString).expandingTildeInPath, encoding: .utf8) else { log("cannot read \(path)"); exit(1) }
  let lines = text.split(separator: "\n").compactMap { (try? JSONSerialization.jsonObject(with: Data($0.utf8))) as? [String: Any] }
  log("replaying \(lines.count) lines to \(server)")
  var delay = 0.0, prevAt: Double? = nil
  for l in lines {
    if let at = l["at"] as? Double { if let p = prevAt { delay += min(6, max(0.05, (at - p) / 1000)) }; prevAt = at } else { delay += 0.2 }
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { post(l) { j in vlog("-> \(j)") } }
  }
  DispatchQueue.main.asyncAfter(deadline: .now() + delay + 7) { log("replay done"); exit(0) }
}

setvbuf(stdout, nil, _IOLBF, 0)
log("RIDEFRAME scale bridge \(VERSION)" + (scanOnly ? "" : ", server \(server), secret from \(dataDir)/scale-bridge.secret"))
var bridge: Bridge? = nil
if let r = replayPath { replay(r) } else {
  if !scanOnly { loadSecret(); if secret.isEmpty { log("no secret yet: start serve.mjs once (it writes \(dataDir)/scale-bridge.secret), or pass --data") } }
  bridge = Bridge()
  if !scanOnly { Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in post(["kind": "hello", "id": "bridge"]) }; post(["kind": "hello", "id": "bridge"]) }
  Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { _ in if bridge?.central.state == .poweredOn { bridge?.startScan() } } // a fresh scan now and then: macOS sometimes stops reporting
}
RunLoop.main.run()
