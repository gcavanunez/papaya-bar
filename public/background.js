chrome.commands.onCommand.addListener((command) => {
  console.log(`Command "${command}" triggered`)
  if (command == 'open-page') {
    chrome.tabs.create({
      url: 'chrome-extension://' + chrome.runtime.id + '/index.html',
    })
  }
})
