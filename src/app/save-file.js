// Save a text file to the user's device. On the web this is a normal download
// link (exactly what the exporters did before). Inside the Android app plain
// download links don't work, so we write the file to the app's own cache with
// @capacitor/filesystem and hand it to the OS Share sheet with @capacitor/share.
// The native plugins are dynamically imported so the web bundle never loads them.
import { isNative } from './platform.js';

/** Save `text` as a file named `name`. Resolves once the save/share is done. */
export async function saveFile(name, text, mime = 'text/plain') {
  if (isNative()) return saveNative(name, text, mime);
  return saveWeb(name, text, mime);
}

function saveWeb(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function saveNative(name, text, mime) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  // Write into the app cache (no storage permission needed), then let the user
  // pick where it goes through the system Share sheet.
  const { uri } = await Filesystem.writeFile({
    path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8,
  });
  await Share.share({ title: name, url: uri, dialogTitle: 'Save or share', mimeType: mime });
}
