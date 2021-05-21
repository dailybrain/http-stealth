#!/usr/bin/env node

// console stuffs...
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const chalk = require('chalk')

// network stuffs...
const tcpPortUsed = require('tcp-port-used')
const axios = require('axios')
const SocksProxyAgent = require('socks-proxy-agent')
const net = require('net')

// puppeteer stuffs...
const puppeteerCode = require('puppeteer')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

// setup proxy
const
    proxyHost = '127.0.0.1',
    proxyPort = '9050',
    proxyOptions = `socks5://${proxyHost}:${proxyPort}`

// setup axios with proxy
const httpsAgent = new SocksProxyAgent(proxyOptions)
const httpAgent = httpsAgent
const axiosWithTor = axios.create({ httpsAgent, httpAgent })

const log = console.log

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const netcat = async(msg) => {
    return new Promise((resolve, reject) => {
        const client = new net.Socket()

        client.connect(9051, '127.0.0.1', () => {
            client.write(msg)
        })

        client.on('data', (data) => {
            resolve(`${data}`)
            client.destroy()
        })

        client.on('close', () => {})

        client.on('error', reject)
    })
}

//
// run new-tor-ip
//
const runNewTorIp = async(argv) => {

    // check tor port
    await tcpPortUsed
        .check(9050, '127.0.0.1')
        .then(
            (inUse) => {
                if (inUse) {
                    log(`${chalk.green('✓')} tor is running`)
                } else {
                    log(`${chalk.red('✗')} tor is not running`)
                    process.exit(1)
                }
            },
            (err) => {
                log(`${chalk.red('✗')} error checking tor port, ${err.message}`)
                process.exit(1)
            })

    // check tor control port
    await tcpPortUsed
        .check(9051, '127.0.0.1')
        .then(
            (inUse) => {
                if (inUse) {
                    log(`${chalk.green('✓')} tor control port is running`)
                } else {
                    log(`${chalk.red('✗')} tor control port is not running`)
                    process.exit(1)
                }
            },
            (err) => {
                log(`${chalk.red('✗')} error checking tor control port, ${err.message}`)
                process.exit(1)
            });

    // renew tor ip
    log(`↪ change tor ip`)

    // check current ip
    const currentTorIp = await axiosWithTor
        .get('http://checkip.amazonaws.com')
        .then(
            (res) => `${res.data}`.trim(),
            (err) => {
                log(`${chalk.red('✗')} can't check current tor ip, ${err.message}`)
                process.exit(1)
            }
        )

    log(` ${chalk.yellow('→')} tor ip ${currentTorIp}`)

    // change tor ip
    let newTorIp = currentTorIp

    // while tor ip is the same
    while (newTorIp == currentTorIp) {

        // sent tor newnym cmd
        await netcat(`authenticate '""'\nsignal newnym\nquit\n`)
            .then(
                (data) => data,
                (err) => {
                    log(` ${chalk.red('✗')} error renew tor ip, ${err.message}`)
                    process.exit(1)
                }
            )

        // check current ip
        newTorIp = await axiosWithTor
            .get('http://checkip.amazonaws.com')
            .then(
                (res) => `${res.data}`.trim(),
                (err) => {
                    log(` ${chalk.red('✗')} can't check current tor ip, ${err.message}`)
                    process.exit(1)
                }
            )

        // if new ip
        if (newTorIp != currentTorIp) {
            log(` ${chalk.yellow('→')} tor ip ${newTorIp}`)
        } else {
            const duration = 5
            log(` ${chalk.red('✗')} retry in ${duration}s`)
            await delay(duration * 1000)
        }
    }

    log(`${chalk.green('✓')} done`)

}


//
// run browse
//
const runBrowse = async(argv) => {

    //log('running browse', argv)

    const url = argv.url
    const headless = argv.headless
    const disableTor = argv.disableTor
    const screenshotFile = argv.screenshotFile

    // pick a random device
    const randomDeviceIdx = Math.floor(Math.random() * Object.keys(puppeteerCode.devices).length)
    const randomDeviceName = Object.keys(puppeteerCode.devices)[randomDeviceIdx]
    const randomDevice = puppeteerCode.devices[randomDeviceName]
    log(`${chalk.green('✓')} will emulate device '${randomDeviceName}'`)

    // build options args
    const launchOptionsArgs = []

    launchOptionsArgs.push(`--incognito`)
    launchOptionsArgs.push(`--user-agent="${randomDevice.userAgent}"`)

    // proxy settings
    if (!disableTor) {
        launchOptionsArgs.push(`--proxy-server=${proxyOptions}`)
    } else {
        launchOptionsArgs.push(`--proxy-server='direct://'`)
        launchOptionsArgs.push(`--proxy-bypass-list=*`)
    }

    // build options
    const launchOptions = {
        headless: headless,
        defaultViewport: randomDevice.viewport,
        args: launchOptionsArgs
    }
    log(`${chalk.green('✓')} use options`, launchOptions)

    // launch browser
    const browser = await puppeteer.launch(launchOptions)
    const page = await browser.newPage()
    await page.emulate(randomDevice)

    // check ip
    await page.goto('http://checkip.amazonaws.com', { waitUntil: 'networkidle0', timeout: 0 })
    await page.content()
    const ip = await page.evaluate(() => document.querySelector('pre').innerHTML.trim())
    log(`${chalk.green('✓')} current ip ${ip}`)

    // go to url
    log(`${chalk.green('✓')} opening '${url}'`)
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 0 })

    // get title
    const pageTitle = await page.title()
    log(`${chalk.green('✓')} title '${pageTitle}'`)

    // take a screenshot
    if (!!screenshotFile) {
        await page.screenshot({ path: screenshotFile, fullPage: true })
        log(`${chalk.green('✓')} screenshot saved at ${screenshotFile}`)
    }

    // close browser
    await browser.close()
    log(`${chalk.green('✓')} done`)

}

yargs(hideBin(process.argv))
    .strictCommands()
    .strictOptions()
    .usage('Usage: $0 <command>')
    .command('new-tor-ip', 'Get a new tor ip',
        () => {},
        runNewTorIp
    )
    .command('browse <url>', 'Browse the given url',
        (yargs) => {
            yargs
                .positional('url', {
                    describe: 'Webpage to visit',
                    type: 'string'
                })
                .option('headless', {
                    description: 'Headless',
                    required: false,
                    default: true,
                    type: 'boolean'
                })
                .option('disable-tor', {
                    description: 'Disable Tor',
                    required: false,
                    type: 'boolean'
                })
                .option('screenshot-file', {
                    describe: 'Screenshot file',
                    type: 'string',
                    required: false
                })
        },
        runBrowse
    )
    .demandCommand(1, 'Missing command')
    .options('verbose', {
        description: 'Be more talkative',
        required: false,
        type: 'boolean'
    })
    .options('silent', {
        description: 'Be not talkative',
        required: false,
        type: 'boolean'
    })
    .help('h')
    .alias('h', 'help')
    .alias('s', 'silent')
    .alias('v', 'verbose')
    .epilog('DailyBrain - Copyright 2021')
    .argv