/**
 * Robust Cross-Environment Clipboard Copy Utility.
 * Implements GitHub's clipboard-copy algorithm with multi-tier fallbacks:
 * 1. navigator.clipboard.writeText (Modern HTTPS / localhost)
 * 2. Fixed textarea selection with preventScroll
 * 3. Synchronous copy event interception (setData on clipboardData)
 * Works across:
 * - Plain HTTP LAN access (e.g. http://192.168.x.x:3000, http://analogair.local:3000)
 * - Mobile Safari / iOS / Android
 * - Embedded webviews and touchscreens
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Try modern navigator.clipboard if supported and permitted
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to DOM and event fallbacks
    }
  }

  // 2. Classical textarea fallback (GitHub clipboard algorithm)
  try {
    const isRTL = document.documentElement.getAttribute('dir') === 'rtl';
    const textArea = document.createElement('textarea');

    textArea.style.fontSize = '12pt';
    textArea.style.border = '0';
    textArea.style.padding = '0';
    textArea.style.margin = '0';
    textArea.style.position = 'fixed';
    textArea.style[isRTL ? 'right' : 'left'] = '-9999px';
    const yPosition = window.pageYOffset || document.documentElement.scrollTop;
    textArea.style.top = `${yPosition}px`;
    textArea.setAttribute('readonly', '');
    textArea.value = text;

    document.body.appendChild(textArea);

    textArea.focus({ preventScroll: true });
    textArea.select();
    textArea.setSelectionRange(0, text.length);

    let success = false;
    try {
      success = document.execCommand('copy');
    } catch {
      success = false;
    }

    document.body.removeChild(textArea);
    if (success) return true;
  } catch {
    // Continue to copy event listener fallback
  }

  // 3. Synchronous copy event listener (reliable in restrictive sandboxes & LAN HTTP)
  try {
    let success = false;
    const listener = (e: ClipboardEvent) => {
      e.preventDefault();
      if (e.clipboardData) {
        e.clipboardData.setData('text/plain', text);
        success = true;
      }
    };
    document.addEventListener('copy', listener);
    try {
      document.execCommand('copy');
    } finally {
      document.removeEventListener('copy', listener);
    }
    if (success) return true;
  } catch {
    // Ignore
  }

  return false;
}
