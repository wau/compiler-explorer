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
    FromConfig = require('../cache/from-config');

class ExecutionProcessor {
    constructor(region, queuename, responseConfig) {
        this.sqs = new AWS.SQS({ region: region });
        this.execRequestsUrl = false;
        this.execResponseBucket = FromConfig.create(responseConfig);

        this.create(queuename).then((url) => {
            this.execRequestsUrl = url;
        });
    }

    putResponse(uniqueId, result) {
        return this.execResponseBucket.put(uniqueId, JSON.stringify(result));
    }

    execute(workcallback) {
        var params = {
            QueueUrl: this.execRequestsUrl,
            AttributeNames: [
                'All'
            ],
            MaxNumberOfMessages: 1,
            MessageAttributeNames: [
                'All'
            ],
            VisibilityTimeout: 0,
            WaitTimeSeconds: 1
        };

        this.sqs.receiveMessage(params, function (err, data) {
            if(!err) {
                workcallback(data.hashedkey, data.execparams).then(result => {
                    this.putResponse(data.MessageBody, result);
                });
            }
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
    ExecutionProcessor
};
