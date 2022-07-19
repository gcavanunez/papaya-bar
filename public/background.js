chrome.commands.onCommand.addListener((command) => {
  console.log(`Command "${command}" triggered`)
  if (command == 'open-page') {
    chrome.tabs.create({
      url: 'chrome-extension://' + chrome.runtime.id + '/index.html',
    })
  }
  if (command == 'copy-link') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs[0]
      const text = `${tab.title}\n${tab.url}`
      chrome.tabs.sendMessage(
        tab.id,
        {
          message: 'copyText',
          textToCopy: text,
        },
        function (response) {},
      )
      // window.navigator.clipboard.writeText(text)
    })
  }
})
