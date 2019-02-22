// Copyright (c) 2017, Matt Godbolt
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright notice,
//       this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

const child_process = require('child_process'),
    path = require('path'),
    logger = require('./logger').logger,
    treeKill = require('tree-kill'),
    execProps = require('./properties').propsFor('execution');

function execute(command, args, options) {
    options = options || {};
    const maxOutput = options.maxOutput || 1024 * 1024;
    const timeoutMs = options.timeoutMs || 0;
    const env = options.env;

    if (options.wrapper) {
        args = args.slice(0); // prevent mutating the caller's arguments
        args.unshift(command);
        command = options.wrapper;

        if (command.startsWith('./')) command = path.join(process.cwd(), command);
    }

    let okToCache = true;
    logger.debug({type: "executing", command: command, args: args, env: env});
    // AP: Run Windows-volume executables in winTmp. Otherwise, run in tmpDir (which may be undefined).
    // https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options
    const child = child_process.spawn(command, args, {
        cwd: options.customCwd ? options.customCwd : (
            (command.startsWith("/mnt") && process.env.wsl) ? process.env.winTmp : process.env.tmpDir
        ),
        env: env,
        detached: process.platform === 'linux'
    });
    let running = true;

    const kill = options.killChild || function () {
        if (running) treeKill(child.pid);
    };

    const streams = {
        stderr: "",
        stdout: "",
        truncated: false
    };
    let timeout;
    if (timeoutMs) timeout = setTimeout(() => {
        logger.warn("Timeout for", command, args, "after", timeoutMs, "ms");
        okToCache = false;
        kill();
        streams.stderr += "\nKilled - processing time exceeded";
    }, timeoutMs);

    function setupOnError(stream, name) {
        if (stream === undefined) return;
        stream.on('error', err => {
            logger.error('Error with ' + name + ' stream:', err);
        });
    }

    function setupStream(stream, name) {
        if (stream === undefined) return;
        stream.on('data', data => {
            if (streams.truncated) return;
            const newLength = (streams[name].length + data.length);
            if ((maxOutput > 0) && (newLength > maxOutput)) {
                streams[name] = streams[name] + data.slice(0, maxOutput - streams[name].length);
                streams[name] += "\n[Truncated]";
                streams.truncated = true;
                kill();
                return;
            }
            streams[name] += data;
        });
        setupOnError(stream, name);
    }

    setupOnError(child.stdin, 'stdin');
    setupStream(child.stdout, 'stdout');
    setupStream(child.stderr, 'stderr');
    child.on('exit', function (code) {
        logger.debug({type: 'exited', code: code});
        if (timeout !== undefined) clearTimeout(timeout);
        running = false;
    });
    return new Promise(function (resolve, reject) {
        child.on('error', function (e) {
            logger.debug("Error with " + command + " args", args, ":", e);
            reject(e);
        });
        child.on('close', function (code) {
            // Being killed externally gives a NULL error code. Synthesize something different here.
            if (code === null) code = -1;
            if (timeout !== undefined) clearTimeout(timeout);
            const result = {
                code: code,
                stdout: streams.stdout,
                stderr: streams.stderr,
                okToCache: okToCache
            };
            logger.debug({type: "executed", command: command, args: args, result: result});
            resolve(result);
        });
        if (options.input) child.stdin.write(options.input);
        child.stdin.end();
    });
}

function firejail(command, args, options) {
    const execPath = path.dirname(command);
    // const execName = path.basename(command);
    return execute(
        'firejail',
        [
            '--quiet',
            // '--private-bin=/bin/bash',
            '--private-dev',
            '--hostname=ce-node',
            '--caps.drop=all',
            // '--ipc-namespace',
            // '--private-home=' + execPath,
            '--net=none'
        ].concat(command).concat(args),
        options);
}

function sandbox(command, args, options) {
    const type = execProps("sandboxType", "firejail");
    logger.info(type);
    if (type === "none") {
        logger.info("Sandbox execution (sandbox disabled)", command, args);
        return execute(command, args, options);
    }
    logger.info("Sandbox execution via firejail", command, args);
    return firejail(command, args, options);
}

module.exports = {
    execute: execute,
    sandbox: sandbox,
    firejail: firejail
};
