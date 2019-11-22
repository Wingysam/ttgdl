const { ArgumentParser } = require('argparse')
const sanitize = require('sanitize-filename')
const mkdirp = require('mkdirp2').promise
const puppeteer = require('puppeteer')
const fs = require('fs').promises
const path = require('path')

const parser = new ArgumentParser({
  version: require('./package.json').version,
  description: 'The Tech Game DL',
  addHelp: true
})
parser.addArgument('id', {
  help: 'The ID of the category to download',
})
parser.addArgument([ '-u', '--username' ], {
  help: 'Your username',
  required: true
})
parser.addArgument([ '-p', '--password' ], {
  help: 'Your password',
  required: true
})

const args = parser.parseArgs()

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox'
    ]
  })
  const page = await browser.newPage()

  await signIn(page, {
    username: args.username,
    password: args.password
  })

  await downloadCategory(browser, page, args.id)
  
}

async function downloadCategory(browser, page, id) {
  await page.goto(`https://www.thetechgame.com/Downloads/cid=${id}.html`, {
    waitUntil: 'domcontentloaded'
  })
  while (true) {
    const links = await page.$$('a.forumlink[title=Download]')
    for (const link of links) {
      await downloadItem(browser, await link.evaluate((node) => node.href))
    }
    const nextPage = await page.$('a[title="Next page"]')
    if (!nextPage) break
    await nextPage.click()
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' })
  }
  await browser.close()

  console.log(`Everything is downloaded! Saved to directory '${args.id}'.`)
}

/**
 * 
 * @param {import('puppeteer').Page} page 
 * @param {Object} credentials 
 */
async function signIn(page, { username, password }) {
  await page.goto('https://www.thetechgame.com/Account.html', { waitUntil: 'domcontentloaded' })
  await page.type('#username', username)
  await page.type('#password', password)
  try {
    await Promise.all([
      page.click('#buttons > button[type="submit"]'),
      page.waitForNavigation({ timeout: 1000 * 120 })
    ])
  } catch (error) {
    if (error.name === 'TimeoutError') {
      console.error('Could not log in! Are your credentials correct?')
      process.exit(1)
    }
    throw error
  }
}

async function downloadItem(browser, url) {
  const id = /\/id=(\d*)\//.exec(url)[1]
  if (!id) throw new Error('no id') // should never happen, but will make debugging easier if it does

  const page = await browser.newPage()

  await page.goto(url, { waitUntil: 'domcontentloaded' })

  await page.$eval('a[title="Manage your profile"]', el => el.outerHTML = '')

  const pageTitle = await page.title()

  const itemName = pageTitle.substr(0, pageTitle.length - ' - The Tech Game'.length)

  const itemPath = path.join(
    path.resolve('./'),
    args.id,
    sanitize(`${itemName} [${id}]`)
  )

  await mkdirp(itemPath)

  await fs.writeFile(path.join(itemPath, 'page.html'), await page.content())
  try {
    await page.pdf({ path: path.join(itemPath, 'page.pdf') })
  } catch {} // when not headless, pdf fails

  await page._client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: itemPath
  })
  await page.click('#buttons > button[title=Download]')

  await page.close()

  console.log(`Downloaded: ${itemName}`)
}

main()