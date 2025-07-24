export const copyToClipboard = (text: string) => {
  copyTextToClipboard(text)
}

export const copyImageToClipboard = async (imageUrl: string): Promise<void> => {
  const blob = await getImageBlobFromUrl(imageUrl)
  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type]: blob,
    }),
  ])
}

async function getImageBlobFromUrl(url: string): Promise<Blob> {
  const fetchedImageData = await fetch(url)
  const blob = await fetchedImageData.blob()
  return blob
}

function fallbackCopyTextToClipboard(text: string) {
  const textArea = document.createElement('textarea')
  textArea.value = text

  // Avoid scrolling to bottom
  textArea.style.top = '0'
  textArea.style.left = '0'
  textArea.style.position = 'fixed'

  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()

  try {
    // Note: document.execCommand is deprecated but kept as fallback for older browsers
    document.execCommand('copy')
  } catch (_err) {
    // Silently fail for older browsers
  }

  document.body.removeChild(textArea)
}

function copyTextToClipboard(text: string) {
  if (!navigator.clipboard) {
    fallbackCopyTextToClipboard(text)
    return
  }
  navigator.clipboard.writeText(text).then(
    function () {
      // Successfully copied to clipboard
    },
    function (_err) {
      // Failed to copy to clipboard
    },
  )
}
