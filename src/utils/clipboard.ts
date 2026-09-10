/**
 * Robust Cross-Environment Clipboard Copy Utility.
 * Works across:
 * - Modern HTTPS / localhost (Async Clipboard API)
 * - Plain HTTP LAN access (e.g. http://192.168.x.x:3000, http://analogair.local:3000)
 * - Mobile Safari / Chrome iOS / Android
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
      // Fall through to DOM selection method
    }
  }

  // 2. Classical readonly textarea selection (standard across GitHub, StackOverflow, etc.)
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;

    // Prevent scrolling to bottom of page in mobile browsers
    textArea.style.top = `${window.pageYOffset || document.documentElement.scrollTop}px`;
    textArea.style.left = '-9999px';
    textArea.style.position = 'absolute';
    textArea.style.opacity = '0';
    textArea.style.fontSize = '16px'; // Prevents iOS zooming
    textArea.setAttribute('readonly', '');

    document.body.appendChild(textArea);

    // iOS Safari requires range selection
    if (navigator.userAgent.match(/ipad|iphone/i)) {
      const range = document.createRange();
      range.selectNodeContents(textArea);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      textArea.setSelectionRange(0, 999999);
    } else {
      textArea.focus();
      textArea.select();
    }

    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);

    if (successful) {
      return true;
    }
  } catch (err) {
    console.warn('execCommand copy failed:', err);
  }

  return false;
}
