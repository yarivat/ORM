/**
 * Created by backand on 3/27/16.
 */



var redis = require('redis'),
    RedisStore = require('socket.io-redis');
var async = require('async');
var _ = require('lodash');

var redisKeys = require('./redis_keys');


var redisConfig = require('../../configFactory').getConfig().redis;

var redisPort = redisConfig.port;
var redisHostname = redisConfig.hostname;
var option = redisConfig.option;

var redis = require('redis');
var redis_scanner = require('redis-scanner');

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


RedisDataSource.prototype.getEvent = function (cb) {
   
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

                current.redisInterface.lpop(redisKeys.logEntry, function (err, data) {
					var entry = {origin: data, parsed: JSON.parse(data)};
                       cb(err, entry);
                });

            }
            else{
                cb(err);
            }
        }
    );
    
};

RedisDataSource.prototype.addEventToSortedSet = function (key, score, message, cb) {

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

                current.redisInterface.zadd([key, score, fMessage], function (err, data) {
                    cb(err, data);
                });
            }
            else{
                cb(err);
            }
        }
    );

}

RedisDataSource.prototype.filterSortedSet = function (key, fromScore, toScore, offset, count, cb) {
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
                current.redisInterface.zrangebyscore(key, fromScore, toScore, 'LIMIT', offset, count, function (err, data) {
                    cb(err, 
                        _.map(
                            data,
                            function(a){ 
                                return JSON.parse(a); 
                            }
                        )
                    );
                });
            }
            else{
                cb(err);
            }
        }
    );

}

RedisDataSource.prototype.scan = function (prefix, onData, onEnd) {
    
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
                var optionsScanner = {               
                    onData: onData,
                    onEnd: onEnd
                };

                if (prefix){
                   optionsScanner.args = ['MATCH', prefix + '*'];
                }

                var scanner = new redis_scanner.Scanner(current.redisInterface, 'SCAN', null, optionsScanner);
                scanner.start();             
            }
            else{
                onEnd(err);
            }
        }
    );

}

RedisDataSource.prototype.isAppWithLoggingPlan = function(appName, cb) {
    var current = this;
    cb(null, true);
    // if (!appName){
    //     cb(null, false);
    // }
    // else{
    //     current.redisInterface.sismember(redisKeys.loggingPlanApps, appName, cb);
    // }
}

RedisDataSource.prototype.expireSortedSet = function (key, topScore, cb) {
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
                async.waterfall([
                    function(callbackWaterfall) {
                        current.isAppWithLoggingPlan(appName, callbackWaterfall);
                    },
                    function(flag, callbackWaterfall) {
                        if (flag){
                            current.redisInterface.zrangebyscore(key, 0, topScore, function (err, data) {
                                current.redisInterface.zremrangebyscore(key, 0, topScore, function (err, dumpData) {
                                    callbackWaterfall(err, flag, data);
                                });
                            });
                        }
                        else{
                            current.redisInterface.zremrangebyscore(key, 0, topScore, function (err, data) {
                                callbackWaterfall(err, flag, null);
                            });
                        }
                    },
                    function(flag, data, callbackWaterfall) {
                        if (!flag) {
                            callbackWaterfall(null);
                        }
                        else if (!data){
                            callbackWaterfall(null);
                        }
                        else {
                            // send somewhere
                            callbackWaterfall(null);
                        }
                    }
                ], function(err, result){
                    cb(err, result);
                });


            }
            else{
                cb(err);
            }
        }
    );

}

RedisDataSource.prototype.expireElementsOfSets = function (prefix, deltaMilliseconds, cb) {
    var current = this;

    async.during(
        function(callback) { 
            return callback(null, !current.readyToRead);
        },
        function(callback) {

            current.scan(
                prefix,

                function(data){
                    var topScore = (new Date()).getTime() - deltaMilliseconds;
                    current.expireSortedSet(data, topScore, function(err){
                       
                    });
                }, 

                function(err){
                   cb(err);
                }
            );
        },
        function (err) {
            cb(err);
        }
    );
}


RedisDataSource.prototype.insertEvent = function (key, message, cb) {

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

                current.redisInterface.lpush(key, fMessage, function (err, data) {
                    cb(err, data);
                });
            }
            else{
                cb(err);
            }
        }
    );

}

RedisDataSource.prototype.delWildcard = function(key, callback) {
    
    var current = this;
 
    current.redisInterface.keys(key, function(err, rows) {
        async.each(rows, function(row, callbackDelete) {
            current.redisInterface.del(row, callbackDelete)
        }, callback)
    });

}

RedisDataSource.prototype.setHash = function(key, hash, callback) {
    
    var current = this;

    var pairs = _.toPairs(hash);
    current.redisInterface.hmset(key, hash, function(err) {
        callback(err);
    });

}

RedisDataSource.prototype.addToSet = function(key, element, callback) {
    
    var current = this;

    current.redisInterface.sadd(key, element, function(err) {
        callback(err);
    });

}

RedisDataSource.prototype.removeFromSet = function(key, element, callback) {
    
    var current = this;

    current.redisInterface.srem(key, element, function(err) {
        callback(err);
    });

}

RedisDataSource.prototype.setMemebers = function(key, element, callback) {
    
    var current = this;

    current.redisInterface.smembers(key, function(err, data) {
        callback(err, data);
    });

}

RedisDataSource.prototype.removeAppForLogging = function(appName, callback) {
    
    var current = this;

    async.waterfall([
        function(cb) {
            redisDataSource.removeFromSet(redisKeys.loggingPlanApps, appName, function(err){
                cb(err);
            });
        },
        function(cb) {
            redisDataSource.del(redisKeys.loggedAppPrefix + appName, function(err){
                cb(err);
            });
        }
    ], function (err, result) {
        callback(err);
    });

}

RedisDataSource.prototype.addAppForLogging = function(appName, data, callback) {
    
    var current = this;

    async.waterfall([
        function(cb) {
            redisDataSource.setHash(redisKeys.loggedAppPrefix + appName, data, function(err){
                cb(err);
            });
        },
        function(cb) {
            redisDataSource.addToSet(redisKeys.loggingPlanApps, appName, function(err){
                cb(err);
            });
        },
        
    ], function (err, result) {
        callback(err);
    });

}

module.exports = RedisDataSource;

// var r = new RedisDataSource();
// r.setHash("h", { "a": "b", "d": "xxx" }, function(err){
//     console.log(err);
//     process.exit(1);
// });

// r.addToSet("s", "first", function(err){
//     console.log(err);
//     r.addToSet("s", "second", function(err){
//         console.log(err);
//         process.exit(1);
//     });
// });



// r.delWildcard('*', function(err, data){
//     console.log(err, data);
//     process.exit(0);
// });

// r.scan(
//     prefix,

//     function(data){
//         console.log(data);
//     }, 
//     function(err){
//         console.log(err);
//         process.exit(0);
//     }
// );

// r.expireElementsOfSets(10, function(err){
//     console.log(err);
//     process.exit(1);
// })
