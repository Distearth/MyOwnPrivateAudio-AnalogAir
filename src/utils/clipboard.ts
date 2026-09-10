/**
 * Cross-environment clipboard copy utility.
 * Supports modern Clipboard API in secure contexts, with resilient fallback to
 * document.execCommand('copy') via a temporary DOM element for insecure contexts
 * (e.g. Raspberry Pi accessed over plain HTTP or local LAN IP like http://192.168.x.x:3000).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 1. Try modern navigator.clipboard if available
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('Modern Clipboard API failed, attempting textarea fallback:', err);
    }
  }

  // 2. Resilient fallback for HTTP, local network IPs, and restricted iframes
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    textArea.style.opacity = '0';
    textArea.style.pointerEvents = 'none';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);

    // iOS and Safari selection compatibility
    const range = document.createRange();
    range.selectNodeContents(textArea);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    textArea.setSelectionRange(0, text.length);

    const successful = document.execCommand('copy');
    if (selection) {
      selection.removeAllRanges();
    }
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('All clipboard copy methods failed:', err);
    return false;
  }
}
