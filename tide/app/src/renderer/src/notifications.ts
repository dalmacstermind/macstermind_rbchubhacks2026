// Desktop notifications. Clicking one brings TIDE's window to the front and runs `onClick`.

// A notification nobody holds on to can be cleaned up from memory, and its click would be lost. It is
// kept even after the pop-up fades, because it can still be clicked in the Windows notification list.
const waitingForClick = new Set<Notification>();

export function notifyDesktop(title: string, body: string, onClick: () => void) {
  const notification = new Notification(title, { body });
  waitingForClick.add(notification);
  notification.onerror = () => waitingForClick.delete(notification);
  notification.onclick = () => {
    waitingForClick.delete(notification);
    window.desktop.focusWindow();
    onClick();
  };
}
