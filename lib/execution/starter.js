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
"use strict";

const
    AWS = require('aws-sdk'),
    FromConfig = require('../cache/from-config'),
    uuidv1 = require('uuid/v1');

class ExecutionStarter {
    constructor(region, queuename, responseConfig) {
        this.sqs = new AWS.SQS({ region: region });
        this.execRequestsUrl = false;
        this.execResponseBucket = FromConfig.create(responseConfig);

        this.create(queuename).then((url) => {
            this.execRequestsUrl = url;
        });
    }

    getResponse(uniqueId) {
        return new Promise((resolve) => {
            // we could do this with https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#objectExists-waiter
            //  but it mentions polling every 5 seconds, which is a bit slow
            setTimeout(() => {
                this.execResponseBucket.get(uniqueId).then(object => {
                    resolve(JSON.parse(object));
                }).catch(() => {
                    this.getResponse(uniqueId).then((result) => {
                        resolve(result);
                    });
                });
            }, 1000);
        });
    }

    getResponseKey(hashedkey) {
        return hashedkey + '_' + uuidv1();
    }

    execute(hashedkey, execparams) {
        return new Promise((resolve, reject) => {
            const uniqueId = this.getResponseKey(hashedkey);

            const params = {
                DelaySeconds: '10',
                MessageAttributes: {
                    hashedkey: {
                        DataType: "String",
                        StringValue: hashedkey
                    },
                    execparams: {
                        DataType: "String",
                        StringValue: JSON.stringify(execparams)
                    }
                },
                MessageBody: uniqueId,
                QueueUrl: this.execRequestsUrl
            };

            this.sqs.sendMessage(params, function (err) {
                if (err) {
                    console.log(err);
                    reject(err);
                } else {
                    this.getResponse(uniqueId).then((response) => {
                        resolve(response);
                    });
                }
            });
        });
    }

    create(name) {
        return new Promise((resolve, reject) => {
            const params = {
                QueueName: name,
                Attributes: {
                    DelaySeconds: '0',
                    MessageRetentionPeriod: '86400'
                }
            };

            this.sqs.createQueue(params, function (err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data.QueueUrl);
                }
            });
        });
    }
}

module.exports = {
    ExecutionStarter
};
