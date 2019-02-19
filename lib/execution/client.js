#!/usr/bin/env node

// Copyright (c) 2019, Compiler Explorer Team
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

const ExecutionProcessor = require('./processor').ExecutionProcessor,
    logger = require('../logger').logger,
    exec = require('../exec'),
    utils = require('../utils'),
    path = require('path'),
    Packager = require('../packager').Packager,
    CompilationEnvironment = require('../compilation-env');

function runExecClient(compilerProps) {
    logger.info(`  Processing execution requests`);
    logger.info("=======================================");
    const env = new CompilationEnvironment(compilerProps, true);
    const ep = new ExecutionProcessor('us-east-1', 'ceExecutionRequest', 'S3(storage.godbolt.org,cache,us-east-1)');
    const packager = new Packager();
    ep.create()
        .then(() => {
            function executeOnce() {
                logger.debug("Waiting for some work...");
                ep.execute(
                    (hashKey, executable, execParams) => {
                        logger.info(`Got request ${hashKey}, ${executable} ${execParams}`);

                        let tempDir = null;
                        return env.newTempDir()
                            .then((td) => {
                                tempDir = td;
                                return env.executableGetByKey(hashKey, tempDir);
                            })
                            .then(filename => {
                                return packager.unpack(filename, tempDir);
                            })
                            .then(() => {
                                return exec.execute(
                                    path.join(tempDir, executable),
                                    [],
                                    {
                                        customCwd: tempDir,
                                        timeoutMs: 3000
                                    }
                                );
                            })
                            .then(result => {
                                result.stdout = utils.parseOutput(result.stdout);
                                result.stderr = utils.parseOutput(result.stderr);
                                return result;
                            })
                            .catch(reject => {
                                logger.error(reject);
                                return {
                                    code: -1,
                                    stdout: [],
                                    stderr: [],
                                    okToCache: false
                                };
                            });
                    })
                    .then(() => executeOnce())
                    .catch((error) => {
                        logger.error(error);
                    });
            }

            executeOnce();
        })
        .catch((e) => {
            logger.error(e);
        });
}

module.exports = {
    runExecClient
};
