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

const log = console.log

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const netcat = async(port, host, msg) => {
    return new Promise((resolve, reject) => {
        const client = new net.Socket()

        client.connect(port, host, () => {
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

const autoScroll = async(page) => {

    await page.evaluate(async() => {

        await new Promise((resolve, reject) => {

            var totalHeight = 0
            const scrollHeight = document.body.scrollHeight

            const timer = setInterval(() => {

                var distance = (Math.floor(Math.random() * window.innerHeight) + 100)

                window.scrollBy(0, distance)
                totalHeight += distance

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer)
                    resolve()
                }

            }, 1000)
        })

    })

}

//
// run new-tor-ip
//
const runNewTorIp = async(argv) => {

    const torProxyHost = argv.torProxyHost
    const torProxyPort = argv.torProxyPort
    const torControlPort = argv.torControlPort

    // check tor port
    await tcpPortUsed
        .check(torProxyPort, torProxyHost)
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
        .check(torControlPort, torProxyHost)
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

    // setup axios with proxy
    const
        proxyOptions = `socks5://${torProxyHost}:${torProxyPort}`,
        httpsAgent = new SocksProxyAgent(proxyOptions),
        httpAgent = httpsAgent,
        axiosWithProxy = axios.create({ httpsAgent, httpAgent })

    // check current ip
    const currentTorIp = await axiosWithProxy
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
        await netcat(torControlPort, torProxyHost, `authenticate '""'\nsignal newnym\nquit\n`)
            .then(
                (data) => data,
                (err) => {
                    log(` ${chalk.red('✗')} error renew tor ip, ${err.message}`)
                    process.exit(1)
                }
            )

        // check current ip
        newTorIp = await axiosWithProxy
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

    const
        url = argv.url,
        headless = argv.headless,
        minStay = argv.minStay * 1000,
        maxStay = argv.maxStay * 1000,
        proxyHost = argv.proxyHost,
        proxyPort = argv.proxyPort,
        screenshotFile = argv.screenshotFile

    // pick a random device
    const randomDeviceIdx = Math.floor(Math.random() * Object.keys(puppeteerCode.devices).length)
    const randomDeviceName = Object.keys(puppeteerCode.devices)[randomDeviceIdx]
    const randomDevice = puppeteerCode.devices[randomDeviceName]
    log(`${chalk.green('✓')} will emulate device '${randomDeviceName}'`)

    // build options args
    const launchOptionsArgs = []

    launchOptionsArgs.push(`--incognito`)
    launchOptionsArgs.push(`--user-agent="${randomDevice.userAgent}"`)

    // set window size
    launchOptionsArgs.push(`--window-size=${randomDevice.viewport.width},${randomDevice.viewport.height}`)

    // proxy settings
    if (!!proxyHost && !!proxyPort) {
        const proxyOptions = `socks5://${proxyHost}:${proxyPort}`
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
        //log(`${chalk.green('✓')} use options`, launchOptions)

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

    // stay on page
    const duration = Math.floor(Math.random() * maxStay) + minStay
    log(`${chalk.green('✓')} stay on page ${duration}ms`)
    await delay(duration)

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
        (yargs) => {
            yargs
                .option('tor-proxy-host', {
                    description: 'Tor Proxy Host',
                    required: false,
                    default: '127.0.0.1',
                    type: 'string'
                })
                .option('tor-proxy-port', {
                    description: 'Tor Proxy Port',
                    required: false,
                    default: 9050,
                    type: 'number'
                })
                .option('tor-control-port', {
                    description: 'Tor Control Port',
                    required: false,
                    default: 9051,
                    type: 'number'
                })
        },
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
                .option('proxy-host', {
                    description: 'Proxy Host',
                    required: false,
                    type: 'string'
                })
                .option('proxy-port', {
                    description: 'Tor Proxy Port',
                    required: false,
                    type: 'number'
                })
                .option('screenshot-file', {
                    describe: 'Screenshot file',
                    type: 'string',
                    required: false
                })
                .option('min-stay', {
                    describe: 'Minimum stay on page (in s)',
                    type: 'number',
                    default: 3,
                    required: false
                })
                .option('max-stay', {
                    describe: 'Maximum stay on page (in s)',
                    type: 'number',
                    default: 10,
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