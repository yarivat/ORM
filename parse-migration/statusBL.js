/**
 * Created by backand on 2/4/16.
 */

var config = require('./config');
var backand = require('backandsdk/backand');
var async = require('async');
var q = require('q');
var RedisBulk = require('./redisBulkStatus');
var redisFileStatus = new RedisBulk();
var logger  = require('./logging/logger').getLogger('updateRelation');


var StatusBl = function (workerId) {
    this.workerId = workerId;
};

StatusBl.prototype.connect = function () {
    logger.info('login with ' + config.username + ' to app ' + config.appName);
    return backand.auth({username: config.username, password: config.passworsd, appname: config.appName})
        .then(function () {
            logger.info("success connect to Backand");
        });
}

StatusBl.prototype.getNextJob = function () {
    var self = this;
    var data = {'workerId': self.workerId};
    var deferred = q.defer();

    function getEqualityFilter() {
        return {fieldName: "workerId", operator: "equals", value: self.workerId};
    }

    backand.get('/1/query/data/getNextJob', data)
        .then(function (result) {
            if (!result) {
                deferred.resolve(undefined);
                return undefined;
            }

            logger.info('found ' + result.length + ' jobs');

            if (result.length === 0) {
                deferred.resolve(undefined);
                return undefined;
            }

            if (result[0].id) {
                deferred.resolve(result[0]);
            }

        });

    return deferred.promise;
};

StatusBl.prototype.finishJob = function (job) {
    job.status = 2;
    job.FinishTime = new Date();
    return backand.put('/1/objects/MigrationJobQueue/' + job.id, job);
}

StatusBl.prototype.takeJob = function (job) {
    // update job taken
    logger.info("try take job for app " + job.appName + ' and jobId ' + job.id);
    job.status = 1;
    job.workerId = this.workerId;

    return backand.put('/1/objects/MigrationJobQueue/' + job.id + '?returnObject=true', job)
        .then(function (res) {
            logger.info('success take job ' + job.id);
        })
}

StatusBl.prototype.fillSchemaTable = function (appName, tables) {
    var deferred = q.defer();

    async.eachSeries(tables, function iterator(tableName, callback) {
        logger.info('start fillTable for ' + tableName + ' in ' + appName);
        var data = {
            appName: appName,
            tableName: tableName,
            insertTime: new Date(),
            endTime: null,
            isFinish: false
        };

        backand.post('/1/objects/MigrationTablesApp?returnObject=true', data)
            .then(function () {
                logger.info('finish fillTable for ' + tableName + ' in ' + appName);
                callback();
            })
    }, function done() {
        deferred.resolve();
    });

    return deferred.promise;


}

StatusBl.prototype.setTableFinish = function (appName, tableName) {
    logger.info('start setTableFinish for ' + tableName + ' in ' + appName);

    var deferred = q.defer();

    backand.get('/1/objects/MigrationTablesApp',undefined ,
        [
            {
                fieldName: 'appName',
                operator: 'equals',
                value: appName
            },
            {
                fieldName: 'tableName',
                operator: 'equals',
                value: tableName
            }]
        )
        .then(function (res) {
            var current = res.data[0];

            if(!current){
                deferred.reject('can"t find intresting this in response: ' + JSON.stringify(res.data));
                return;
            }
            var id = current.id;

            logger.trace('finish get step setTableFinish for ' + tableName + ' in ' + appName + ' id is ' + id + ' res: ' + JSON.stringify(res));
            current.isFinish = true;
            current.endTime = new Date();

            backand.put('/1/objects/MigrationTablesApp/' + id, current)
                .then(function () {
                    logger.info('finish setTableFinish for ' + tableName + ' in ' + appName);
                    deferred.resolve();
                })

        })

    return deferred.promise;
}

StatusBl.prototype.setCurrentObjectId = function (appName, file, objectId) {
    // go to redis set
    return redisFileStatus.setStatus(appName, file, objectId);
}

StatusBl.prototype.getCurrentObjectId = function (appName) {
    return redisFileStatus.getStatus(appName);
}

StatusBl.prototype.cleanup = function () {
    return backand.get('/1/query/data/cleanup')

}

StatusBl.prototype.enqueueSimpleJob = function () {
    var data = {
        appName: 'test',
        parseUrl: 'www.parse.com',
        appToken: 'appToken',
        status: '0',
        parseSchema: 'www.parseSchema.com',
        workerId: '',
        CreationDate: new Date(),
        FinishTime: null
    };

    return backand.post('/1/objects/MigrationJobQueue', data)
}


/*
 var a = new StatusBl(1);
 a.connect()
 .then(function () {
 var u = a.getNextJob()
 .then(function (job) {
 console.log(job);
 a.takeJob(job);


 });
 }
 );
 */

module.exports = StatusBl;