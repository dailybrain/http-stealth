#!/usr/bin/env node

const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const chalk = require('chalk')
const tcpPortUsed = require('tcp-port-used')
const axios = require('axios')
const SocksProxyAgent = require('socks-proxy-agent')
const net = require('net')
const log = console.log

// setup axios with tor
const
    proxyHost = '127.0.0.1',
    proxyPort = '9050'
const proxyOptions = `socks5://${proxyHost}:${proxyPort}`
const httpsAgent = new SocksProxyAgent(proxyOptions)
const httpAgent = httpsAgent
const axiosWithTor = axios.create({ httpsAgent, httpAgent })

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

// run new-tor-ip
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

const runBrowse = (argv) => {
    log('running browse', argv)
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
                    describe: 'an Uniform Resource Locator',
                    type: 'string'
                })
                .option('disable-tor', {
                    description: 'Disable Tor',
                    required: false,
                    type: 'boolean'
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