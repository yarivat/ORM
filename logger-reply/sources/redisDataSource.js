/**
 * Created by backand on 3/27/16.
 */

var redis = require('redis'),
    RedisStore = require('socket.io-redis');
 var async = require('async');

var redisConfig = require('../../configFactory').getConfig().redis;

var redisPort = redisConfig.port;
var redisHostname = redisConfig.hostname;
var option = redisConfig.option;

var redis = require('redis');



function RedisDataSource() {

    var current = this;
    this.readyToRead = false;
    this.redisInterface = redis.createClient(redisPort, redisHostname, option);

    this.redisInterface.on('connect', function () {
        current.readyToRead = true;
        console.log('connected to redis');
    });
    this.redisInterface.on('reconnecting', function () {
        current.readyToRead = false;
        console.log('reconnecting to redis');
    });
    this.redisInterface.on('end', function () {
        current.readyToRead = false;
        console.log('redis connection closed');
    });
    this.redisInterface.on('error', function (err) {
        console.log('error', err);
        //this.readyToRead = true;
    });

}


RedisDataSource.prototype.getEvent = function (logEntry, cb) {
   
    var current = this;
    async.during(
        function (callback) {     
            return callback(null, !current.readyToRead);
        },
        function (callback) {
            setTimeout(callback, 1000);
        },
        function (err) {
            if (!err){

                var fMessage = JSON.stringify(message);

                current.redisInterface.lpop(logEntry, function (err, data) {
                    cb(err, data);
                });

            }
            else{
                cb(err);
            }
        }
    );
    
};

RedisDataSource.prototype.insertEvent = function (logEntry, message, cb) {

    var current = this;

    async.during(
        function (callback) {
            return callback(null, !current.readyToRead);
        },
        function (callback) {
            setTimeout(callback, 1000);
        },
        function (err) {

            if (!err){

                var fMessage = JSON.stringify(message);

                current.redisInterface.lpush(logEntry, fMessage, function (err, data) {
                    cb(err, data);
                });
            }
            else{
                cb(err);
            }
        }
    );

}

RedisDataSource.prototype.addEventToSortedSet = function (logEntry, score, message, cb) {

    var current = this;

    async.during(
        function (callback) {
            return callback(null, !current.readyToRead);
        },
        function (callback) {
            setTimeout(callback, 1000);
        },
        function (err) {

            if (!err){

                var fMessage = JSON.stringify(message);

                current.redisInterface.zadd([logEntry, score, fMessage], function (err, data) {
                    cb(err, data);
                });
            }
            else{
                cb(err);
            }
        }
    );

}

RedisDataSource.prototype.filterSortedSet = function (logEntry, fromScore, toScore, offset, count, cb) {
    console.log('filterSortedSet', logEntry, fromScore, toScore);
    var current = this;

    async.during(
        function (callback) {
            return callback(null, !current.readyToRead);
        },
        function (callback) {
            setTimeout(callback, 1000);
        },
        function (err) {

            if (!err){     
                current.redisInterface.zrangebyscore(logEntry, fromScore, toScore, 'WITHSCORES', 'LIMIT', offset, count, function (err, data) {
                    console.log(err);
                    cb(err, data);
                });
            }
            else{
                cb(err);
            }
        }
    );

}

RedisDataSource.prototype.expireSortedSet = function (logEntry, topScore, cb) {
    var current = this;

    async.during(
        function (callback) {
            return callback(null, !current.readyToRead);
        },
        function (callback) {
            setTimeout(callback, 1000);
        },
        function (err) {

            if (!err){     
                current.redisInterface.zremrangebyscore(logEntry, 0, topScore, function (err, data) {
                    console.log(err);
                    cb(err, data);
                });
            }
            else{
                cb(err);
            }
        }
    );

}

RedisDataSource.prototype.insertEvent = function (logEntry, message, cb) {

    var current = this;

    async.during(
        function (callback) {
            return callback(null, !current.readyToRead);
        },
        function (callback) {
            setTimeout(callback, 1000);
        },
        function (err) {

            if (!err){

                var fMessage = JSON.stringify(message);

                current.redisInterface.lpush(logEntry, fMessage, function (err, data) {
                    cb(err, data);
                });
            }
            else{
                cb(err);
            }
        }
    );

}

module.exports = RedisDataSource;
