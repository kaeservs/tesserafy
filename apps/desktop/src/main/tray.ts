/**
 * The overlay's way back: an icon in the menu bar (macOS) or the notification
 * area (Windows), always reachable whatever the overlay is doing.
 *
 * Without it, click-through was a trap. Turned on, the overlay ignores the
 * mouse — which is the point — so nothing on it can be clicked again,
 * including the button that turns it off or the one that quits. On macOS
 * there is no Dock icon or menu bar either (a window kept above full-screen
 * meetings makes the app a background agent), and on Windows it is not in the
 * taskbar and cannot take focus for Alt+F4. What was left was Activity Monitor
 * or Task Manager.
 *
 * The icon is four tiles — a tessera. It is drawn here as PNG data, 16 px and
 * 32 px, rather than shipped as a file, because only compiled code is
 * packaged. On macOS it is a template image, black on transparent, which the
 * menu bar recolours to match itself; on Windows it is indigo, which reads on
 * a light or a dark taskbar.
 */
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';

const ICONS = {
  template16:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHklEQVR4nGNgGEzgPxZMjNyoAYMKDHwYDAMDBgYAAM9NY51R6rBqAAAAAElFTkSuQmCC',
  template32:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAO0lEQVR4nO3SMQoAIAwEwfv/p/UDFkcI2MxCyugUSaR3p5iNnfHnU0CFAAAAAJC+HyEAAABA+9jGjpQLweiKhPc5iSAAAAAASUVORK5CYII=',
  color16:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJklEQVR4nGNITvvIQAmmSDO6Af+xYIJyowZQORZGo3EwGDAw0QgAIvodu3i/BuQAAAAASUVORK5CYII=',
  color32:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAUklEQVR4nO3UvQkAMAiEUXcNZP9MkAyQHySIZ/EVV56+QrTWhykjXQ7gBZiORHSOAM+gX8DWAwAAAIDri8wKgJIA+RECAAAAgHdYRKfmKwaQmgXBZXLt7aaoRgAAAABJRU5ErkJggg==',
};

function icon(): NativeImage {
  const mac = process.platform === 'darwin';
  const image = nativeImage.createFromDataURL(mac ? ICONS.template16 : ICONS.color16);
  image.addRepresentation({ scaleFactor: 2, dataURL: mac ? ICONS.template32 : ICONS.color32 });
  if (mac) image.setTemplateImage(true);
  return image;
}

/** What the tray can see and do. The main process owns the state; this only shows it. */
export interface TrayControls {
  visible(): boolean;
  setVisible(visible: boolean): void;
  clickThrough(): boolean;
  setClickThrough(enabled: boolean): void;
  protection(): boolean;
  setProtection(enabled: boolean): void;
  /** This overlay's version, and a newer one if there is one. */
  version(): string;
  update(): string | null;
  openUpdate(): void;
  checkForUpdates(): void;
  /** Each shortcut's accelerator if it registered, or null if another app owns it. */
  shortcuts(): { visible: string | null; clickThrough: string | null };
  quit(): void;
}

/**
 * The keys beside a menu item, only displayed: the shortcut itself is
 * registered globally, and registering it again here would take it twice.
 * One another app owns says so instead.
 */
function keys(accelerator: string | null): Partial<MenuItemConstructorOptions> {
  return accelerator
    ? { accelerator, registerAccelerator: false }
    : { sublabel: 'Shortcut unavailable: another app uses it' };
}

export interface OverlayTray {
  /** Rebuild the menu after the state it shows has changed, from anywhere. */
  refresh(): void;
}

export function createTray(controls: TrayControls): OverlayTray {
  const tray = new Tray(icon());
  tray.setToolTip('Tesserafy');

  const refresh = () => {
    const update = controls.update();
    const shortcuts = controls.shortcuts();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        // Which version this is, for anyone asked "what are you running?".
        { label: `Tesserafy ${controls.version()}`, enabled: false },
        update
          ? { label: `Download version ${update}…`, click: () => controls.openUpdate() }
          : { label: 'Check for updates', click: () => controls.checkForUpdates() },
        { type: 'separator' },
        {
          label: controls.visible() ? 'Hide the overlay' : 'Show the overlay',
          click: () => controls.setVisible(!controls.visible()),
          ...keys(shortcuts.visible),
        },
        { type: 'separator' },
        {
          label: 'Click-through',
          sublabel: 'The meeting under the overlay stays clickable',
          ...keys(shortcuts.clickThrough),
          type: 'checkbox',
          checked: controls.clickThrough(),
          click: (item) => controls.setClickThrough(item.checked),
        },
        {
          label: 'Hidden from screen share',
          type: 'checkbox',
          checked: controls.protection(),
          click: (item) => controls.setProtection(item.checked),
        },
        { type: 'separator' },
        { label: 'Quit Tesserafy', click: () => controls.quit() },
      ]),
    );
  };

  // Windows: a left click brings the overlay back, as a notification-area
  // icon usually does; the menu is on the right button. macOS opens the menu
  // on any click.
  if (process.platform !== 'darwin') {
    tray.on('click', () => controls.setVisible(true));
  }

  refresh();
  return { refresh };
}
