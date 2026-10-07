// Which processes are taking audio input right now, on macOS: the Mac's
// counterpart to the Windows record the overlay reads (src/main/calls.ts).
//
// Core Audio keeps one object per process using audio, and says of each
// whether it is running input — the record behind the microphone indicator
// in the menu bar (macOS 14.2 and later). This prints that list, once, as
// JSON, and exits; the overlay's main process runs it every few seconds:
//
//   {"supported": true, "users": [{"bundle": "us.zoom.xos", "pid": 4210}]}
//   {"supported": false}            on a macOS without the record
//
// It reads properties only: it opens no device, records nothing, and needs no
// permission beyond the overlay's own.

import CoreAudio
import Foundation

func emit(_ object: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: object) {
        FileHandle.standardOutput.write(data)
    }
}

func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
}

if #available(macOS 14.2, *) {
    let system = AudioObjectID(kAudioObjectSystemObject)
    var list = address(kAudioHardwarePropertyProcessObjectList)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(system, &list, 0, nil, &size) == noErr else {
        emit(["supported": false])
        exit(0)
    }
    var processes = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(system, &list, 0, nil, &size, &processes) == noErr else {
        emit(["supported": false])
        exit(0)
    }

    var users: [[String: Any]] = []
    for process in processes {
        var input = address(kAudioProcessPropertyIsRunningInput)
        var running: UInt32 = 0
        var runningSize = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(process, &input, 0, nil, &runningSize, &running) == noErr, running != 0 else {
            continue
        }

        var bundleAddress = address(kAudioProcessPropertyBundleID)
        var bundle: Unmanaged<CFString>?
        var bundleSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        var bundleID = ""
        if AudioObjectGetPropertyData(process, &bundleAddress, 0, nil, &bundleSize, &bundle) == noErr,
           let value = bundle?.takeRetainedValue() {
            bundleID = value as String
        }

        var pidAddress = address(kAudioProcessPropertyPID)
        var pid: pid_t = 0
        var pidSize = UInt32(MemoryLayout<pid_t>.size)
        _ = AudioObjectGetPropertyData(process, &pidAddress, 0, nil, &pidSize, &pid)

        users.append(["bundle": bundleID, "pid": Int(pid)])
    }
    emit(["supported": true, "users": users])
} else {
    emit(["supported": false])
}
