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
    logger = require('../logger').logger;

class ExecutionProcessor {
    constructor(region, queueName, responseConfig) {
        this.sqs = new AWS.SQS({region: region});
        this.execRequestsUrl = false;
        this.execResponseBucket = FromConfig.create(responseConfig);
        this.queueName = queueName;
    }

    create() {
        return this.createInternal(this.queueName).then((url) => {
            this.execRequestsUrl = url;
        });
    }

    putResponse(uniqueId, result) {
        logger.debug("Writing result", result, "to", uniqueId);
        return this.execResponseBucket.put(uniqueId, JSON.stringify(result));
    }

    execute(workCallback) {
        const params = {
            QueueUrl: this.execRequestsUrl,
            MaxNumberOfMessages: 1,
            MessageAttributeNames: [
                '.*'
            ],
            VisibilityTimeout: 30,
            WaitTimeSeconds: 15
        };

        logger.debug('receiving message with params', params);
        return new Promise((resolve, reject) => {
            this.sqs.receiveMessage(params, (err, data) => {
                if (err) {
                    return reject(err);
                }
                logger.debug('received', data);
                if (data.Messages) {
                    const message = data.Messages[0];
                    logger.debug('message', JSON.stringify(message));
                    workCallback(
                        message.MessageAttributes.hashedKey.StringValue,
                        message.MessageAttributes.executable.StringValue,
                        message.MessageAttributes.execParams.StringValue)
                        .then(result => {
                            this.putResponse(message.Body, result);
                            this.sqs.deleteMessage(
                                {
                                    QueueUrl: this.execRequestsUrl,
                                    ReceiptHandle: message.ReceiptHandle
                                },
                                (err, data) => {
                                    if (err) {
                                        logger.error("Error deleting", err);
                                    } else {
                                        logger.debug("deleted ok", data);
                                    }
                                });
                        });
                }
                resolve();
            });
        });
    }

    createInternal(name) {
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
    ExecutionProcessor
};
