import { describe, expect, it } from 'vitest';
import { callChange, meetingMicrophoneUsers, MICROPHONE_KEY } from '../src/main/calls';

const root = MICROPHONE_KEY.replace(/^HKCU/, 'HKEY_CURRENT_USER');
const entry = (key: string, start: string, stop: string) =>
  `${root}\\${key}\n    LastUsedTimeStart    REG_QWORD    0x${start}\n    LastUsedTimeStop    REG_QWORD    0x${stop}\n`;

const output = [
  `${root}\n    Value    REG_SZ    Allow\n`,
  entry('MSTeams_8wekyb3d8bbwe', '1dd5101770132ca', '0'),
  `${root}\\NonPackaged\n    Value    REG_SZ    Allow\n`,
  entry('NonPackaged\\C:#Users#Dana#AppData#Roaming#Zoom#bin#Zoom.exe', '1dd4f7c0aa26f7f', '1dd4f7e0640840b'),
  entry('NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe', '1dd5101770132ca', '0'),
  entry('NonPackaged\\C:#Program Files (x86)#Steam#steamapps#common#dota 2 beta#game#bin#win64#dota2.exe', '1dd4e7353bb7c8a', '0'),
  entry('NonPackaged\\C:#Program Files#Tesserafy#Tesserafy.exe', '1dd5101770132ca', '0'),
].join('\r\n');

describe('a call starting', () => {
  it('finds the meeting apps using the microphone now — a browser included — and not games or this app', () => {
    expect(meetingMicrophoneUsers(output, 'C:\\Program Files\\Tesserafy\\Tesserafy.exe').map((user) => user.label)).toEqual([
      'Teams',
      'your browser',
    ]);
  });

  it('leaves out an app that has stopped, or never started', () => {
    const quiet = entry('NonPackaged\\C:#Zoom#bin#Zoom.exe', '0', '0') + entry('NonPackaged\\C:#Zoom2#Zoom.exe', '1dd4f7c0aa26f7f', '1dd4f7e0640840b');
    expect(meetingMicrophoneUsers(quiet, '')).toEqual([]);
  });

  it('says which app started, and when the last one stopped', () => {
    const zoom = { key: 'C:#Zoom.exe', label: 'Zoom' };
    const chrome = { key: 'C:#chrome.exe', label: 'your browser' };
    expect(callChange([], [zoom])).toEqual({ started: 'Zoom', ended: false });
    expect(callChange([zoom], [zoom, chrome])).toEqual({ started: 'your browser', ended: false });
    expect(callChange([zoom], [])).toEqual({ started: null, ended: true });
    expect(callChange([], [])).toEqual({ started: null, ended: false });
  });
});
