process.chdir(__dirname);
var journey = require('journey');
var async = require('async');
var _ = require('underscore');

var validator = require('./validate_schema').validator;
var transformer = require('./transform').transformer;
var renamer = require('./transform').rename;
var applyRename = require('./transform').applyRename;
var fetcher = require('./backand_to_object').fetchTables;
var executer = require('./execute_sql').executer;
var getConnectionInfo = require('./get_connection_info').getConnectionInfo;
var version = require('./version').version;

var config = require('./configFactory').getConfig();
var api_url = config.api_url;
var loggingPlanUrl = api_url + "/loggingPlan";
var sendLambdaLogsUrl = api_url + "/sendLambdaLogs"
var redisKeys = require('./logger-reply/sources/redis_keys');
var bcrypt = require('bcrypt-nodejs');

var Logger = require('./logging/log_with_redis');
const util = require('util');
var logger = new Logger(config.socketConfig.serverAddress + ":" + config.socketConfig.serverPort);
var socketConfig = config.socketConfig.serverAddress + ':' + config.socketConfig.serverPort;

var socket = require('socket.io-client')(socketConfig);
var transformJson = require('./json_query_language/nodejs/algorithm').transformJson;
var substitute = require('./json_query_language/nodejs/substitution').substitute;
var getTemporaryCredentials = require('./hosting/sts').getTemporaryCredentials;
var gcmSender = require('./push/gcm_sender').sendMessage;

var s3Folders = require('./list-s3/list_folder');
var s3File = require('./list-s3/file');
var azureFile = require('./azure/file');
var gcpFile = require('./gcp/file');


var downloadIntoS3 = require('./list-s3/download_into_s3');
var filterCloudwatchLogs = require('./list-s3/filter_cloudwatch_logs').filterCloudwatchLogs;
var waitLogs = require('./list-s3/wait_for_cloudwatch_logs').waitLogs;

var createLambda = require('./lambda/create_lambda_function').createLambdaFunctionFromS3;
var createLambdaAnyone = require('./lambda/create_lambda_function_anyone').createLambdaFunctionFromS3;
var callLambda = require('./lambda/call_lambda_function').callLambdaFunctionFromS3;
var updateLambda = require('./lambda/update_lambda_function').updateLambdaFunctionFromS3;
var updateLambdaAnyone = require('./lambda/update_lambda_function_anyone').updateLambdaFunctionFromS3;
var deleteLambda = require('./lambda/delete_lambda_function').deleteLambdaFunctionFromS3;
var deleteLambdaAnyone = require('./lambda/delete_lambda_function').deleteLambdaFunctionFromS3;
var getLambdasList = require('./lambda/get_lambda_functions_list').getLambdaList;
var getLambdaFunction = require('./lambda/get_lambda_function').getLambdaFunction;
var invokeLambdaAndLog = require('./lambda/invoke_lambda_and_log').invokeLambdaAndLog;
var invokeAzureFunction = require('./azure/invoke_function').invokeFunction;
var getAzureList = require('./azure/get_functions_list').getFunctionsList;
var invokeGCPFunction = require('./gcp/invoke_function').invokeFunction;
var invokeFnProjectFunction = require('./fnproject/invoke_function').invokeFunction;
var invokeOpenFaasFunction = require('./openFaas/invoke_function').invokeFunction;
var getGCPFunctions = require('./gcp/get_functions_list').getFunctionsList;
var getFnProjectFunctions = require('./fnproject/get_functions_list').getFunctionsList;
var getOpenFaasFunctions = require('./openFaas/get_functions_list').getFunctionsList;

var putCron = require('./cron/put_cron').putCron;
var deleteCron = require('./cron/delete_cron').deleteCron;
var getCron = require('./cron/get_cron').getCron;

var crypto = require('crypto');
var folder = require('./list-s3/folder');

var RedisDataSource = require('./logger-reply/sources/redisDataSource');
var redisDataSource = new RedisDataSource();

var request = require('request');
var fs = require('fs');
var jsonfile = require('jsonfile');


fs.watchFile(__filename, function (curr, prev) {
    logger.logFields(true, null, "regular", "schema server", null, "close process for update");
    process.exit();
});

//
// Create a Router
//
var router = new (journey.Router)({filter: authorize});

// placeholder for function to test headers are authorized
function isAuthorized(headers) {
    return true;
}

// authorize with headers
function authorize(request, body, cb) {
    return isAuthorized(request.headers)
        ? cb(null)
        : cb(new journey.NotAuthorized('Not Authorized'));
}

// Create the routing table
router.map(function () {
    this.root.bind(function (req, res) {
        res.send(version)
    });

    // validate a json schema
    this.post('/validate').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "validate", "start validate", null);
        logger.logFields(true, req, "regular", "schema server", "validate", util.format("%s %j", "validate input", data), null);
        result = validator(data)


        if (result.error) {
            logger.logFields(true, req, "exception", "schema server", "validate", util.format("%s %j", "validate error", result.error), null);
            res.send(500, {error: result.error}, {});
        }
        else {
            logger.logFields(true, req, "regular", "schema server", "validate", "validate OK");
            res.send(200, {}, result);
        }

    });

    // transform one json schema into another json schema
    this.post('/transform').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "transform", "start transform");
        logger.logFields(true, req, "regular", "schema server", "transform", util.format("%s %s %j %s %j %s %d", "transform", "oldSchema:", data.oldSchema, "newSchema:", data.newSchema, "severity:", data.severity));
        var isValidNewSchema = validator(data.newSchema);
        logger.logFields(true, req, "regular", "schema server", "transform", util.format("%s %j", "isValidNewSchema", isValidNewSchema));

        if (isValidNewSchema.error) {
            logger.logFields(true, req, "exception", "schema server", "transform", util.format("%s %j", "transform error", isValidNewSchema.error));
            res.send(500, {error: isValidNewSchema.error}, {});
        }
        else if (isValidNewSchema.valid) {
            var isSpecialPrimary = false;
            if (data.isSpecialPrimary)
                isSpecialPrimary = true;

            // get the statements for the rename
            var resultPlainRename = renamer(data.newSchema);
            // how will the old schema look after the rename
            var renamedOldSchema = applyRename(data.newSchema, data.oldSchema);
            // how will the new schema look after the rename
            var renamedNewSchema = applyRename(data.newSchema, data.newSchema);
            // transform when both sides already renames so it is the standard transform
            result = transformer(renamedOldSchema, renamedNewSchema, data.severity, isSpecialPrimary);
            // precede the alteration statemtns with the rename stamtents
            result.alter =  resultPlainRename.statements.concat(result.alter);

            logger.logFields(true, req, "regular", "schema server", "transform", util.format("%j", result));

            if (result.error) {
                logger.logFields(true, req, "exception", "schema server", "transform", util.format("%s %j", "transform error", isValidNewSchema.error));
                res.send(500, {error: isValidNewSchema.error}, {});
            }
            else {
                logger.logFields(true, req, "regular", "schema server", "transform", "transform OK");
                res.send(200, {}, result);
            }
        }
        else {
            isValidNewSchema.valid = "never";
            logger.logFields(true, req, "regular", "schema server", "transform", "transform OK never");

            res.send(200, {}, isValidNewSchema);
        }
    });

    // transform a json schema into antoher schema
    this.post('/transformAuthorized').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "transformAuthorized", "start transformAuthorized");
        var tokenStructure = getToken(req.headers);
        if (tokenStructure) {
            fetcher(tokenStructure[1], tokenStructure[0], req.headers.appname, true, false, function (err, oldSchema) {
                if (err) {
                    logger.logFields(true, req, "exception", "schema server", "transformAuthorized", util.format("%s %j", "error in transformAuthorized ", err));
                    res.send(400, {error: err}, null);
                }
                else {
                    logger.logFields(true, req, "regular", "schema server", "transformAuthorized", util.format("%s %s %j %s %j %s %d", "transform", "oldSchema:", data.oldSchema, "newSchema:", data.newSchema, "severity:", data.severity));
                    if (data.withoutValidation) {
                        result = transformer(oldSchema, data.newSchema, data.severity)
                        logger.logFields(true, req, "regular", "schema server", "transformAuthorized", result);

                        if (result.error) {
                            logger.logFields(true, req, "exception", "schema server", "transformAuthorized", util.format("%s %j", "error in transformAuthorized ", result.error));
                            res.send(500, {error: result.error}, {});
                        }
                        else {
                            logger.logFields(true, req, "regular", "schema server", "transformAuthorized", "OK in transformAuthorized");
                            res.send(200, {}, result);
                        }

                    }
                    else {
                        // test if new schema is valid
                        var isValidNewSchema = validator(data.newSchema);
                        logger.logFields(true, req, "regular", "schema server", "transformAuthorized", util.format("%s %j", "isValidNewSchema", isValidNewSchema));
                        if (isValidNewSchema.error) {
                            logger.logFields(true, req, "exception", "schema server", "transformAuthorized", util.format("%s %j", "error in transformAuthorized schema not valid", result.error));
                            res.send(500, {error: result.error}, {});
                        }
                        else if (isValidNewSchema.valid) {
                            result = transformer(oldSchema, data.newSchema, data.severity)
                            logger.logFields(true, req, "regular", "schema server", "transformAuthorized", util.format("%j", result));
                            if (result.error) {
                                logger.logFields(true, req, "exception", "schema server", "transformAuthorized", util.format("%s %j", "error in transformAuthorized schema not valid2", result.error));
                                res.send(500, {error: result.error}, {});
                            }
                            else {
                                logger.logFields(true, req, "regular", "schema server", "transformAuthorized", "OK transformAuthorized");
                                res.send(200, {}, result);
                            }

                        }
                        else {
                            //isValidNewSchema.valid = "never";
                            //res.send(200, {}, result);
                            isValidNewSchema.valid = "never";
                            logger.logFields(true, req, "regular", "schema server", "transformAuthorized", "transformAuthorized OK never");
                            res.send(200, {}, isValidNewSchema);
                        }
                    }
                }
            });
        }
        else {
            logger.logFields(true, req, "exception", "schema server", "transformAuthorized", "401 on transformAuthorized");
            res.send(401, {}, null);
        }
    });

    // execute an array of sql statements
    this.post('/execute').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "execute", "start execute");
        if(data !== undefined) {
            logger.logFields(true, req, "regular", "schema server", "execute", util.format("%s %s %d %s %s %s", "start execute", data.hostname, data.port, data.db, data.username, data.password));
        }

        if (!data.hostname || !data.port || !data.db || !data.username || !data.password) {
            logger.logFields(true, req, "exception", "schema server", "execute", "send 400 on execute");
            res.send(400, {}, null);
        }
        else {
            logger.logFields(true, req, "exception", "schema server", "execute", util.format("%s %s %d %s %s %s %j", "db details", data.hostname, data.port, data.db, data.username, data.password, data.statementsArray));
            executer(data.hostname, data.port, data.db, data.username, data.password, data.statementsArray, function (err, result) {
                if (!err) {
                    logger.logFields(true, req, "regular", "schema server", "execute", util.format("%s %s %j %j", "execute result", err, result));
                    res.send(200, {error: err}, result);
                }
                else {
                    logger.logFields(true, req, "exception", "schema server", "execute", "execute send 500");
                    res.send(500, {}, null);
                }
            });
        }
    });

    // obtain the json structure for a schema
    this.post('/json').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "json", "start json");
        var tokenStructure = getToken(req.headers);
        logger.logFields(true, req, "regular", "schema server", "execute", util.format("%j", tokenStructure));

        if (tokenStructure) {
            fetcher(tokenStructure[1], tokenStructure[0], req.headers.appname, false, false, function (err, result) {

                if (err) {
                    logger.logFields(true, req, "exception", "schema server", "execute", util.format("%s %j","error in json", err));
                    res.send(400, {error: err}, null);
                }
                else {
                    logger.logFields(true, req, "regular", "schema server", "execute", util.format("%s %j", "OK on json", result));
                    res.send(200, {}, result);
                }

            });

        }
        else {
            logger.logFields(true, req, "exception", "schema server", "execute", "401 on json");
            res.send(401, {}, null);
        }
    });

    // get database connection info for app
    this.post('/connectioninfo').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "connectioninfo", "start connectioninfo");
        var tokenStructure = getToken(req.headers);
        logger.logFields(true, req, "regular", "schema server", "connectioninfo", util.format("%j", tokenStructure));

        if (tokenStructure) {
            getConnectionInfo(tokenStructure[1], tokenStructure[0], data.appName, function (err, result) {
                if (!err) {
                    logger.logFields(true, req, "regular", "schema server", "connectioninfo", util.format("%s %s %s", "result on connectioninfo", err, result));
                    res.send(200, {error: err}, result);
                }
                else {
                    logger.logFields(true, req, "exception", "schema server", "connectioninfo", "result 500 connectioninfo");
                    res.send(500, {}, null);
                }
            });
        }
        else {
            logger.logFields(true, req, "exception", "schema server", "connectioninfo", "result 401 connectioninfo");
            res.send(401, {}, null);
        }
    });

    // translate json into mysql
    // status code according to result
    // error returned in header
    this.post('/transformJson').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "transformJson", "start transformJson");
        var tokenStructure = getToken(req.headers);
        logger.logFields(true, req, "regular", "schema server", "transformJson", util.format("%j", tokenStructure));

        fetcher(tokenStructure[1], tokenStructure[0], data.appName, true, true, function (err, sqlSchema) {
            if (err) {
                logger.logFields(true, req, "exception", "schema server", "transformJson", util.format("%s %j", "transformJson error", err));
                res.send(500, {error: err}, null);
            }
            else {
                transformJson(data.json, sqlSchema, data.isFilter, data.shouldGeneralize, function (err, result) {
                    logger.logFields(true, req, "regular", "schema server", "transformJson", util.format("%s %j %j", "transformJson result", err, result));
                    res.send(200, {error: err}, result);
                });
            }
        });

    });

    // substitute variables into query
    // req should contain sql - the sql statement, and assignment - variable assignment
    this.post('/substitution').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "substitution", "start substitution");
        logger.logFields(true, req, "regular", "schema server", "substitution", util.format("%s %j", data.sql, data.assignment));
        substitute(data.sql, data.assignment, function (err, result) {
            logger.logFields(true, req, "regular", "schema server", "substitution", "finish substitution");
            logger.logFields(true, req, "regular", "schema server", "substitution", util.format("%j", result));
            res.send(200, {}, result);
        });
    });

    //use for the socket.io
    /*
     data.mode can heve 4 modes.
     "All", "Role", "Users", "Others"

     All - send to all users of the App.

     Role - a specific role should be specified at "role"

     Users - an array of users should be specified at "users"

     Others - send to others that sender.
     */
    this.post('/socket/emit').bind(function (req, res, data) {
        if(data !== undefined) {
            logger.logFields(true, req, "regular", "schema server", "socket/emit", "start socket/emit " + data.eventName + " " + data.mode);
        }

        if (data.mode == "All") {
            socket.emit("internalAll", {"data": data.data, "appName": req.headers.app, "eventName": data.eventName});
        }
        else if (data.mode == "Role" && data.role !== null) {
            socket.emit("internalRole", {
                "data": data.data,
                "role": data.role,
                "appName": req.headers.app,
                "eventName": data.eventName
            });
        }
        else if (data.mode == "Users" && data.users !== null) {
            socket.emit("internalUsers", {
                "data": data.data,
                "users": data.users,
                "appName": req.headers.app,
                "eventName": data.eventName
            });
        }
        else if (data.mode == "Others") {
            socket.emit("internalOthers", {"data": data.data, "appName": req.headers.app, "eventName": data.eventName});
        }
        else { // don't understand mode, log error
            logger.logFields(true, req, "execption", "schema server", "socket/emit", util.format("%s %j", "Can't find valid mode for:", data));
        }

        logger.logFields(true, req, "regular", "schema server", "socket/emit", "finish socket emit");
        res.send(200, {}, {});
    });

    // get sts credentials for bucket
    this.post('/bucketCredentials').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "bucketCredentials", "start bucketCredentials");
        getTemporaryCredentials(data.bucket, data.dir, function (err, data) {
            if (err) {
                logger.logFields(true, req, "execption", "schema server", "bucketCredentials", util.format("%s %j", "bucketCredentials error", err));
                res.send(500, {error: err}, {});
            }
            else {
                logger.logFields(true, req, "execption", "schema server", "bucketCredentials", util.format("%s %j", "bucketCredentials OK", data));
                res.send(200, {}, data);
            }
        });
    });

    // upload a content file to S3
    this.post('/uploadFile').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "bucketCredentials", "start uploadFile");
        logger.logFields(true, req, "regular", "schema server", "uploadFile", data.storage.fileName + ' ' + data.storage.dir);

        switch(data.cloudProvider){
            case "AWS":
                s3File.uploadFile(data.credentials, data.storage.fileName, data.storage.fileType, data.file, data.storage.bucket, data.storage.dir, function(err, response) {
                    if (err){
                        logger.logFields(true, req, "execption", "schema server", "uploadFile", util.format("%s %j", "uploadFile error", err));
                        res.send(500, { error: err }, {});
                    }
                    else{
                        logger.logFields(true, req, "regular", "schema server", "uploadFile", "uploadFile OK " + response.link);
                        res.send(200, {}, {link: response.link});
                    }
                });
            break;
            case "Azure":
                azureFile.uploadFile(data.credentials.connectionString, data.storage.fileName, data.storage.fileType, data.file, data.storage.bucket, data.storage.dir, function(err, response) {
                    if (err){
                        logger.logFields(true, req, "execption", "schema server", "uploadFile", util.format("%s %j", "uploadFile error", err));
                        res.send(500, { error: err }, {});
                    }
                    else{
                        logger.logFields(true, req, "regular", "schema server", "uploadFile", "uploadFile OK " + response.link);
                        res.send(200, {}, {link: response.link});
                    }
                });
            break;
            case "GCP":
                gcpFile.uploadFile(data.credentials.privateKey, data.credentials.clientEmail, data.storage.fileName, data.storage.fileType, data.file, data.storage.bucket, data.storage.dir, function(err, response) {
                    if (err){
                        logger.logFields(true, req, "execption", "schema server", "uploadFile", util.format("%s %j", "uploadFile error", err));
                        res.send(500, { error: err }, {});
                    }
                    else{
                        logger.logFields(true, req, "regular", "schema server", "uploadFile", "uploadFile OK " + response.link);
                        res.send(200, {}, {link: response.link});
                    }
                });
            break;
        }

        
    });

    // delete a content file from S3
    this.post('/deleteFile').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "deleteFile", "start deleteFile");
        logger.logFields(true, req, "regular", "schema server", "deleteFile", data.bucket, data.fileName);

        switch(data.cloudProvider){
            case "AWS":
                s3File.deleteFile(data.credentials, data.storage.bucket, data.storage.dir, data.storage.fileName, function(err, response) {
                    if (err){
                        logger.logFields(true, req, "execption", "schema server", "deleteFile", util.format("%s %j", "deleteFile error", err), err.stack);
                        res.send(500, { error: err }, {});
                    }
                    else{
                        logger.logFields(true, req, "regular", "schema server", "deleteFile", "deleteFile OK");
                        res.send(200, {}, {});
                    }
                });
            break;
            case "Azure":
                azureFile.deleteFile(data.credentials.connectionString, data.storage.bucket, data.storage.dir, data.storage.fileName, function(err, response) {
                    if (err){
                        logger.logFields(true, req, "execption", "schema server", "deleteFile", util.format("%s %j", "deleteFile error", err));
                        res.send(500, { error: err }, {});
                    }
                    else{
                        logger.logFields(true, req, "regular", "schema server", "deleteFile", "deleteFile OK " + response.link);
                        res.send(200, {}, {link: response.link});
                    }
                });
            break;
            case "GCP":
                gcpFile.deleteFile(data.credentials.privateKey, data.credentials.clientEmail, data.storage.bucket, data.storage.dir, data.storage.fileName, function(err, response) {
                    if (err){
                        logger.logFields(true, req, "execption", "schema server", "deleteFile", util.format("%s %j", "deleteFile error", err));
                        res.send(500, { error: err }, {});
                    }
                    else{
                        logger.logFields(true, req, "regular", "schema server", "deleteFile", "deleteFile OK " + response.link);
                        res.send(200, {}, {link: response.link});
                    }
                });
            break;
        }
        
    });

    // dumb list of sub folder of app
    this.post('/listFolder').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "listFolder", "start listFolder");
        logger.logFields(true, req, "regular", "schema server", "listFolder", util.format("%s %s %s", data.bucket, data.folder, data.pathInFolder));
        s3Folders.listFolder(data.bucket, data.folder, data.pathInFolder, function(err, files) {
            if (err){
                res.send(500, { error: err }, {});
            }
            else{
                res.send(200, {}, files);
            }
        });
    });

    this.post('/deleteFolder').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "deleteFolder", "start deleteFolder");
        logger.logFields(true, req, "regular", "schema server", "deleteFolder", util.format("%s %s", data.bucket, data.folder));
        s3Folders.deleteFolder(data.bucket, data.folder, function(err) {
            if (err){
                res.send(500, { error: err }, {});
            }
            else{
                res.send(200, {}, {});
            }
        });
    });

    // smart list with caching of sub folder of app
    this.post('/smartListFolder').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "smartListFolder", "start smartListFolder");
        logger.logFields(true, req, "regular", "schema server", "smartListFolder", util.format("%s %s %s", data.bucket, data.folder, data.pathInFolder));
        s3Folders.filterFiles(data.bucket, data.folder, data.pathInFolder, function(err, filterFilesOutput) {
            if (err){
                if (err != "not stored"){
                    res.send(500, { error: err }, {});
                }
                else{
                    logger.logFields(true, req, "regular", "schema server", "smartListFolder", "storeFolder");
                    s3Folders.storeFolder(data.bucket, data.folder, function(err){ // fetch and store the whole bucket
                        if (err){
                            res.send(500, { error: err }, {});
                        }
                        else{ // fetch our path
                            s3Folders.filterFiles(data.bucket, data.folder, data.pathInFolder, function(err, filterFilesAfterStoreFolderOutput){
                                if (err){
                                    res.send(500, { error: err }, {});
                                }
                                else{
                                    res.send(200, {}, filterFilesAfterStoreFolderOutput);
                                }
                            });
                        }
                    });
                }
            }
            else{
                res.send(200, {}, filterFilesOutput);
            }
        });
    });

    this.post('/createLambda').bind(function (req, res, data) {
        createLambda(data.bucket, data.folder, data.fileName, data.functionName, data.handlerName, data.callFunctionName, function(err, data){
            if (err){
                res.send(500, { error: err }, {});
            }
            else{
                res.send(200, {}, data);
            }
        })
    });

    this.post('/createLambdaAnyone').bind(function (req, res, data) {
        // parameters of POST:

        // optional:
        // awsRegion 
        // accessKeyId 
        // secretAccessKey 

        // bucket
        // folder
        // fileName
        // functionName
        // handlerName
        // callFunctionName
        data = fillAwsData(data);
        createLambdaAnyone(data.awsRegion, data.accessKeyId, data.secretAccessKey, data.bucket, data.folder, data.fileName, data.functionName, data.handlerName, data.callFunctionName, function(err, data){
            if (err){
                res.send(500, { error: err }, {});
            }
            else{
                res.send(200, {}, data);
            }
        })
    });

    this.post('/callLambda').bind(function (req, res, data) {
        callLambda(data.folder, data.functionName, data.payload, function(err, data){
            if (err){
                res.send(500, { error: err }, {});
            }
            else{
                res.send(200, {}, data);
            }
        })
    });


    this.post('/updateLambda').bind(function (req, res, data) {
        updateLambda(data.bucket, data.folder, data.fileName, data.functionName, function(err, data){
            if (err){
                res.send(500, { error: err }, {});
            }
            else{
                res.send(200, {}, data);
            }
        })
    });

    this.post('/updateLambdaAnyone').bind(function (req, res, data) {
        data = fillAwsData(data);
        updateLambdaAnyone(data.bucket, data.folder, data.fileName, data.functionName, function(err, data){
            if (err){
                res.send(500, { error: err }, {});
            }
            else{
                res.send(200, {}, data);
            }
        })
    });


    this.post('/deleteLambda').bind(function (req, res, data) {
        deleteLambda(data.folder, data.functionName, function(err, data){
            if (err){
                res.send(500, { error: err }, {});
            }
            else{
                res.send(200, {}, data);
            }
        })
    });

    this.post('/deleteLambdaAnyone').bind(function (req, res, data) {
        data = fillAwsData(data);
        deleteLambdaAnyone(data.folder, data.functionName, function(err, data){
            if (err){
                res.send(500, { error: err }, {});
            }
            else{
                res.send(200, {}, data);
            }
        })
    });

    this.post('/putCron').bind(function (req, res, data) {
        putCron(data.name, data.schedule, data.lambdaArn, data.name, data.input, data.active, data.description, function(err, data){
            if (err){
                res.send(500, { error: err }, {});
            }
            else{
                res.send(200, {}, data);
            }
        })
    });

    this.post('/deleteCron').bind(function (req, res, data) {
        deleteCron(data.name, data.name, function(err, data){
            if (err){
                res.send(500, { error: err }, {});
            }
            else{
                res.send(200, {}, data);
            }
        })
    });

    this.post('/getCron').bind(function (req, res, data) {
        getCron(data.namePrefix, function(err, data){
            if (err){
                res.send(500, { error: err }, {});
            }
            else{
                res.send(200, {}, data);
            }
        })
    });

    // send push messages 
    // data has fields: 
    // devices - array of { deviceType, deviceId }
    // gcmOptions - object with field ServerAPIKey
    // apnsOptions - object
    // messageLabel - string
    // msgObject - hash of data to be sent with push notification
    this.post('/push/send').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "push/send", 'start push/send');
        // separate into gcm and apns
        async.parallel(
            {
                gcm: function (callback) {

                    if (data.gcmOptions && data.gcmOptions.ServerAPIKey) {
                        var deviceIds = _.filter(data.devices, function (d) {
                            return d.deviceType == 'Android';
                        });
                        gcmSender(data.gcmOptions.ServerAPIKey, deviceIds, data.messageLabel, data.msgObject, function (err) {
                            callback(null, err);
                        });
                    }
                    else {
                        callback(null, "no gcm information");
                    }


                },
                apns: function (callback) {
                    if (data.apnsOptions) {
                        var deviceIds = _.filter(data.devices, function (d) {
                            return d.deviceType == 'iOS';
                        });
                        // sendMessage(data.apnsOptions.ServerAPIKey, deviceIds, data.messageLabel, data.msgObject, function(err){
                        //     callback(null, err);
                        // }); 
                        callback(null, null);
                    }
                    else {
                        callback(null, "no apns information");
                    }

                }
            },

            function (err, results) {
                logger.logFields(true, req, "regular", "schema server", "push/send", util.format("%s %j", "send result", results));
                // why results is in error?
                res.send(200, {error: results}, {});
            }
        );


    });

    this.post('/parseCheckPassword').bind(function(req,res,data){
        logger.logFields(true, req, "regular", "schema server", "parseCheckPassword", util.format("%j", data));
        var password = data.password
        var hashedPassword = data.hashedPassword;

        if(!password || !hashedPassword){
            res.send(500, { error: 'password and hashedPassword must be fulfilled' }, {});
        }

        bcrypt.compare(password, hashedPassword, function(err, success) {
            if (err) {
                res.send(500, { error: err }, {});
            } else {
                logger.logFields(true, req, "regular", "schema server", "parseCheckPassword", success);
                if(success){
                    res.send(200, {}, null);
                }
                else {
                    res.send(401, { msg: 'password and hash are not same' }, {});
                }
            }
        });
    })

    this.post('/security/compare').bind(function(req,res,data){
        logger.logFields(true, req, "regular", "schema server", "security/compare", util.format("%j", data));
        var password = data.password
        var hashedPassword = data.hashedPassword;

        if(!password || !hashedPassword){
            res.send(500, { error: 'password and hashedPassword must be fulfilled' }, {});
        }

        bcrypt.compare(password, hashedPassword, function(err, success) {
            if (err) {
                res.send(500, { error: err }, {});
            } else {
                logger.logFields(true, req, "regular", "schema server", "parseCheckPassword", success);
                if(success){
                    res.send(200, {}, null);
                }
                else {
                    res.send(401, { msg: 'password and hash are not same' }, {});
                }
            }
        });
    })

    this.post('/security/encrypt').bind(function(req,res,data){
        var algorithm = 'aes256'; // or any other algorithm supported by OpenSSL
        var password = data.password
        var text = data.text;

        if(!password || !text){
            res.send(500, { error: 'password and text must be fulfilled' }, {});
        }

        try {
            var cipher = crypto.createCipher(algorithm, password);
            var encrypted = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
            res.send(200, {}, {encrypted:encrypted});
        }
        catch (err){
            res.send(500, { error: err }, {});
        }
    })

    this.post('/security/decrypt').bind(function(req,res,data){
        var algorithm = 'aes256'; // or any other algorithm supported by OpenSSL
        var password = data.password
        var encrypted = data.encrypted;

        if(!password || !encrypted){
            res.send(500, { error: 'password and encrypted must be fulfilled' }, {});
        }

        try {
            var decipher = crypto.createDecipher(algorithm, password);
            var decrypted = decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
            res.send(200, {}, {decrypted: decrypted});
        }
        catch (err){
            res.send(500, { error: err }, {});
        }
    })

    this.post('/security/hash').bind(function(req,res,data){
        logger.logFields(true, req, "regular", "schema server", "security/hash", util.format("%j", data));
        var password = data.password
        var salt = null;
        if (data.salt){
            salt = data.salt;
        }

        if(!password){
            res.send(500, { error: 'password must be fulfilled' }, {});
        }

        bcrypt.hash(password, salt, null, function(err, encrypted) {
            if (err) {
                res.send(500, { error: err }, {});
            } else {
                logger.logFields(true, req, "regular", "schema server", "security/hash", util.format("%s", encrypted));
                res.send(200, {}, {encrypted:encrypted});
            }
        });
    })

    this.post('/folder/rename').bind(function(req,res,data){
        //logger.logFields(true, req, "regular", "schema server", "security/hash", util.format("%j", data));
        var bucketName = data.bucketName;
        var oldFolder = data.oldFolder;
        var newFolder = data.newFolder;

        if(!bucketName){
            res.send(500, { error: 'bucketName must be fulfilled' }, {});
        }
        if(!oldFolder){
            res.send(500, { error: 'oldFolder must be fulfilled' }, {});
        }
        if(!newFolder){
            res.send(500, { error: 'newFolder must be fulfilled' }, {});
        }

        folder.rename(password, salt, null, function(err, data) {
            if (err) {
                res.send(500, { error: err }, null);
            } else {
                //logger.logFields(true, req, "regular", "schema server", "security/hash", util.format("%s", encrypted));
                res.send(200, null, {});
            }
        });
    })

    // fetch a page of last hour exceptions
    // parameters of POST:
    // appName
    // fromTimeEpochTime - start time in milliseconds from epoch
    // toTimeEpochTime - end time in milliseconds from epoch
    // offset - start of page
    // count - number of elements on page

    this.post('/lastHourExceptions').bind(function(req,res,data){
 
        logger.logFields(true, req, "regular", "schema server", "lastHourExceptions", util.format("%j", data));
        redisDataSource.filterSortedSet(redisKeys.sortedSetPrefix + data.appName, data.fromTimeEpochTime, data.toTimeEpochTime, data.offset, data.count, function(err, a){
            if (err) {
                res.send(500, { error: err }, {});
            } else {
                res.send(200, {}, _.map(
                    _.filter(a, function (e) { return filterException(e.parsed); }), 
                    function(e) { return mungeLogOfException(e.parsed); }
                ));
            }
        });
    });

    // add app to S3 logging
    // parameters of POST:
    // appName
    // bucketName
    // accessKeyId
    // secretAccessKey

    this.post('/addAppToLoggingPlan').bind(function(req,res,data){

        console.log(true, req, "regular", "schema server", "addAppLoggingPlan", util.format("%j", data)); 
        redisDataSource.addAppForLogging(data.appName, _.omit(data, 'appName'), function(err){
            console.log(err);
            if (err) {
                res.send(500, { error: err }, {});
            } 
            else {
                res.send(200, {}, {});
            }
        });
    });

    // remove app from S3 logging
    // parameters of POST:
    // appName

    this.post('/removeAppFromLoggingPlan').bind(function(req,res,data){

        logger.logFields(true, req, "regular", "schema server", "removeAppLoggingPlan", util.format("%j", data)); 
        redisDataSource.removeAppForLogging(data.appName, function(err){
            if (err) {
                res.send(500, { error: err }, {});
            } 
            else {
                res.send(200, {}, {});
            }
        });
    });

    // parameters of POST:
    // awsRegion
    // accessKeyId
    // secretAccessKey  

    this.post("/getFunctionsList").bind(function(req,res,data){
        logger.logFields(true, req, "regular", "schema server", "getFunctionsList", util.format("%j", "input", data), null);   
        console.log(data);
        switch(data.cloudProvider){
            case "AWS":
                getLambdasList(data.credentials.awsRegion, data.credentials.accessKeyId, data.credentials.secretAccessKey, function(err, results){
                    if (err) {
                        logger.logFields(true, req, "exception", "schema server", "getFunctionsList", util.format("%s %j", "error", err), null);
                        res.send(500, { error: err }, {});
                    } 
                    else {
                        logger.logFields(true, req, "regular", "schema server", "getFunctionsList", "getFunctionsList OK");
                        res.send(200, {}, results);
                    }
                });
            break;
            case "Azure":
                getAzureList(data.credentials.subscriptionId, data.credentials.appId, data.credentials.tenant, data.credentials.password, function(err, results){
                    if (err) {
                        logger.logFields(true, req, "exception", "schema server", "getFunctionsList", util.format("%s %j", "error", err), null);
                        res.send(500, { error: err }, {});
                    } 
                    else {
                        logger.logFields(true, req, "regular", "schema server", "getFunctionsList", "getFunctionsList OK");
                        res.send(200, {}, results);
                    }
                });
            break;
            case "GCP":
                getGCPFunctions(data.credentials.privateKey, data.credentials.clientEmail, data.credentials.projectName, function(err, results){
                    if (err) {
                        logger.logFields(true, req, "exception", "schema server", "getFunctionsList", util.format("%s %j", "error", err), null);
                        res.send(500, { error: err }, {});
                    } 
                    else {
                        logger.logFields(true, req, "regular", "schema server", "getFunctionsList", "getFunctionsList OK");
                        res.send(200, {}, results);
                    }
                });
            break;
            case "FnProject":
                getFnProjectFunctions(data.credentials.gateway, data.credentials.connectionString, function(err, results){
                    if (err) {
                        logger.logFields(true, req, "exception", "schema server", "getFunctionsList", util.format("%s %j", "error", err), null);
                        res.send(500, { error: err }, {});
                    } 
                    else {
                        logger.logFields(true, req, "regular", "schema server", "getFunctionsList", "getFunctionsList OK");
                        res.send(200, {}, results);
                    }
                });
            break;
            case "OpenFaas":
                getOpenFaasFunctions(data.credentials.gateway, data.credentials.connectionString, data.credentials.projectName, function(err, results){
                    if (err) {
                        logger.logFields(true, req, "exception", "schema server", "getFunctionsList", util.format("%s %j", "error", err), null);
                        res.send(500, { error: err }, {});
                    } 
                    else {
                        logger.logFields(true, req, "regular", "schema server", "getFunctionsList", "getFunctionsList OK");
                        res.send(200, {}, results);
                    }
                });
            break;
        }
    });

    // parameters of POST:
    // awsRegion
    // accessKeyId
    // secretAccessKey 
    // functionName 

    this.post("/getLambdaFunction").bind(function(req,res,data){
        logger.logFields(true, req, "regular", "schema server", "getLambdaFunction", util.format("%j", "input", data), null);   

        getLambdaFunction(data.awsRegion, data.accessKeyId, data.secretAccessKey, data.functionName, function(err, results){
            if (err) {
                logger.logFields(true, req, "exception", "schema server", "getLambdaFunction", util.format("%s %j", "error", err), null);
                res.send(500, { error: err }, {});
            } 
            else {
                logger.logFields(true, req, "regular", "schema server", "getLambdaFunction", "getLambdaFunction OK");
                res.send(200, {}, results);
            }
        });
            
    });

    // parameters of POST:

    // sourceZipUrl
    // sourceBytesSize

    // bucket
    // folder
    // fileName
    // functionName
    // handlerName
    // callFunctionName

    // will copy source zip into s3 bucket, and then create the function

    this.post("/copyCreateLambdaFunction").bind(function(req,res,data){
        logger.logFields(true, req, "regular", "schema server", "copyCreateLambdaFunction", util.format("%j", "input", data), null);        

        async.series({
            copy: function(callback) {
                downloadIntoS3(data.sourceZipUrl, data.sourceBytesSize, data.bucket, data.folder, data.fileName, function (errPut, awsData) {
                    callback(errPut, awsData);
                });
            },
            create: function(callback){
                createLambda(data.bucket, data.folder, data.fileName, data.functionName, data.handlerName, data.callFunctionName, function(errCreate, dataCreate){
                    callback(errCreate, dataCreate);
                });
            }
        }, function(err, results) {
            if (err) {
                logger.logFields(true, req, "exception", "schema server", "copyCreateLambdaFunction", util.format("%s %j", "error", err), null);
                res.send(500, {error: err}, {});
            }
            else {
                logger.logFields(true, req, "regular", "schema server", "copyCreateLambdaFunction", "copyCreateLambdaFunction OK"); 
                res.send(200, {}, results.create);        
            } 
        });          
    });

    // parameters of POST:
    // awsRegion
    // accessKeyId
    // secretAccessKey 
    // functionName 

    // will return url and size in bytes of s3 object containing code

    this.post("/downloadLambda").bind(function(req, res, data){
        logger.logFields(true, req, "regular", "schema server", "downloadLambda", util.format("%j", "input", data), null);   

        getLambdaFunction(data.awsRegion, data.accessKeyId, data.secretAccessKey, data.functionName, function(err, results){
            if (err) {
                logger.logFields(true, req, "exception", "schema server", "downloadLambda", util.format("%s %j", "error", err), null);
                res.send(500, {error: err}, {});
            } 
            else {
                logger.logFields(true, req, "regular", "schema server", "downloadLambda", "downloadLambda OK");
                res.send(200, {}, { sourceUrl: results.Code.Location, sourceBytesSize: results.Configuration.CodeSize });
            }
        });  
    });

    // parameters of POST:
    // cloudProvider
    // credencials
    // specific cloud config 
    
    this.post('/invokeFunction').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "invokeFunction", util.format("%j", "input", data), null);  

        switch(data.cloudProvider){
            case "AWS":
                data.credentials = fillAwsData(data.credentials);
                invokeLambdaAndLog(data.credentials.awsRegion, data.credentials.accessKeyId, data.credentials.secretAccessKey, data.function.arn, data.payload, data.isProduction, function(err, result){
                    if (err){
                        logger.logFields(true, req, "exception", "schema server", "invokeFunction", util.format("%s %j", "error", err), null);
                        res.send(500, { error: err }, {});
                    }
                    else{
                        logger.logFields(true, req, "regular", "schema server", "invokeFunction", "invokeFunction OK"); 
                        if (data.isProduction){
                            res.send(200, {}, result);                
                        }
                        else{
                            res.send(200, {}, result); 
                            // async.setImmediate(function() {
                            //     waitLogs(
                            //         data.awsRegion, 
                            //         data.accessKeyId, 
                            //         data.secretAccessKey, 
                            //         data.logGroupName, 
                            //         result.requestId, 
                            //         data.limit, 
                            //         result.startTime, 
                            //         result.endTime, 
                            //         data.logWaitPeriod, 
                            //         data.logTimesToWait,
                            //         function(err, logs){
                            //             if (err){
                            //                 logger.logFields(true, req, "exception", "schema server", "invokeLambda", util.format("%s %j", "waitlog error", err), null);
                            //                 console.log(err, {});
                            //                 // request.post(sendLambdaLogsUrl);
                            //             }
                            //             else{
                            //                 logger.logFields(true, req, "regular", "schema server", "invokeLambda", "waitlog OK"); 
                            //                 console.log(null, logs);
                            //                 // request.post(sendLambdaLogsUrl)
                            //             }
                            //     });
                            // });
                        }
                    }
                })
            break;
            case "Azure":
                //data.isProduction - not used yet
                invokeAzureFunction(data.function.name, data.function.appName, data.function.authLevel, data.function.trigger, data.method, data.function.key, data.payload, function(err, result){
                    if (err){
                        logger.logFields(true, req, "exception", "schema server", "invokeFunction", util.format("%s %j", "error", err), null);
                        res.send(500, { error: err }, {});
                    }
                    else {
                        logger.logFields(true, req, "regular", "schema server", "invokeFunction", "invokeFunction OK"); 
                        res.send(200, {}, result);                
                    }
                });
            break;
            case "GCP":
                //data.isProduction - not used yet
                invokeGCPFunction(data.function.trigger, data.method, data.payload, function(err, result){
                    if (err){
                        logger.logFields(true, req, "exception", "schema server", "invokeFunction", util.format("%s %j", "error", err), null);
                        res.send(500, { error: err }, {});
                    }
                    else {
                        logger.logFields(true, req, "regular", "schema server", "invokeFunction", "invokeFunction OK"); 
                        res.send(200, {}, result);                
                    }
                });
            break;
            case "FnProject":
                //data.isProduction - not used yet
                invokeFnProjectFunction(data.function.trigger, data.method, data.payload, function(err, result){
                    if (err){
                        logger.logFields(true, req, "exception", "schema server", "invokeFunction", util.format("%s %j", "error", err), null);
                        res.send(500, { error: err }, {});
                    }
                    else {
                        logger.logFields(true, req, "regular", "schema server", "invokeFunction", "invokeFunction OK"); 
                        res.send(200, {}, result);                
                    }
                });
            break;
            case "OpenFaas":
                //data.isProduction - not used yet
                invokeOpenFaasFunction(data.function.trigger, data.method, data.payload, function(err, result){
                    if (err){
                        logger.logFields(true, req, "exception", "schema server", "invokeFunction", util.format("%s %j", "error", err), null);
                        res.send(500, { error: err }, {});
                    }
                    else {
                        logger.logFields(true, req, "regular", "schema server", "invokeFunction", "invokeFunction OK"); 
                        res.send(200, {}, result);                
                    }
                });
            break;
        }
        
        
    });

    // parameters of POST:
    // awsRegion
    // accessKeyId
    // secretAccessKey 
    // logGroupName
    // awsRequestId
    // limit
    // startTime
    // endTime

    this.post('/waitLambdaLog').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "waitLambdaLog", util.format("%j", "input", data), null);  

        waitLogs(data.awsRegion, data.accessKeyId, data.secretAccessKey, data.logGroupName, data.awsRequestId, data.limit, data.startTime, data.endTime, function(err, logs){
            if (err){
                logger.logFields(true, req, "exception", "schema server", "waitLambdaLog", util.format("%s %j", "error", err), null);
                res.send(500, { error: err }, {});
            }
            else{
                logger.logFields(true, req, "regular", "schema server", "waitLambdaLog", "waitLambdaLog OK"); 
                res.send(200, {}, logs);
            }
        });
    }); 

    // parameters of POST:
    // awsRegion
    // accessKeyId
    // secretAccessKey 
    // logGroupName
    // awsRequestId

    this.post('/lambdaLog').bind(function (req, res, data) {
        logger.logFields(true, req, "regular", "schema server", "lambdaLog", util.format("%j", "input", data), null);  

        filterCloudwatchLogs(data.awsRegion, data.accessKeyId, data.secretAccessKey, data.logGroupName, data.awsRequestId, function(err, logs){
            if (err){
                logger.logFields(true, req, "exception", "schema server", "lambdaLog", util.format("%s %j", "error", err), null);
                res.send(500, { error: err }, {});
            }
            else{
                logger.logFields(true, req, "regular", "schema server", "lambdaLog", "lambdaLogmd OK"); 
                res.send(200, {}, logs);
            }
        })
    });    

});

function fillAwsData(data){
    var credentials = data;
    if (!data.awsRegion){
        var credentials = config.AWSDefaultConfig.credentials;
        data = _.extend(data, credentials, { awsRegion: 'us-east-1' });
    }
    if (!data.functionArn){
        data = _.extend(data, { functionArn: 'arn:aws:lambda:us-east-1:328923390206:function:' + data.folder + "_" + data.functionName })
    }    
    return data;
}

function filterException(e){
    var f1 = (e.FreeText.replace(config.api_url,'') != '/1/app/sync');
    var f2 = !e.Username.match(/@backand.com/);
    var f3 = (e.FreeText.match(config.api_url) ? true : false);
    return f1 && f2 && f3;
}

function mungeLogOfException(e){
    var AdjustedRequest = (e.FreeText.match(/\?/g) ? e.FreeText : e.FreeText + '?').replace(/\/\?/g, '?');

    return {
        Type: extractType(AdjustedRequest),
        ObjectName: extractObjectName(AdjustedRequest),
        ActionName: extractActionName(AdjustedRequest),
        QueryName: extractQueryName(AdjustedRequest),
        Guid: e.Guid,
        Request: e.FreeText.replace(config.api_url, ''),
        AdjustedRequest: AdjustedRequest,
        Username: e.Username,
        ClientIP: e.ClientIP,
        Time: e.Time,
        Refferer: e.Refferer,
        Duration: e.RequestTime,
        Method: e.Action,
        LogMessage: e.LogMessage,
        LogType: e.LogType,
        ExceptionMessage: e.ExceptionMessage,
        Trace: e.Trace
    }

}

function extractType(txt){
    if (txt.match('/1/query/data')){
        return 'query';
    }
    else if (txt.match('(/1/objects|/1/table/data|/1/view/data)')){
        if (txt.match('/action/')){
            return 'action';
        }
        else{
            return 'object';
        }
    }
    else{
        return null;
    }
}

function extractObjectName(txt){
    if (txt.match(/objects\/action\/[a-zA-z0-9]\?/g)){
        var results = txt.exec(/objects\/action\/[a-zA-z0-9]\?/);
        return results[0].replace(/objects\/action\/|\?$/g, '');
    }
    else if (txt.match(/objects\/action\/.*\/[a-zA-z0-9]\?/g)){        
        var results = txt.exec(/objects\/action\/.\/[a-zA-z0-9]\?/);
        return results[0].replace(/objects\/action\/|\/.\?$/g, '');
    }    
    else if (txt.match(/objects\/[a-zA-z0-9]\?/g)){
        var results = txt.exec(/objects\/[a-zA-z0-9]\?/);
        return results[0].replace(/objects\/|\?$/, '');
    }
    else if (txt.match(/(objects\/.*\/[a-zA-z0-9]\?)/)){
        var results = txt.exec(/objects\/.\/[a-zA-z0-9_]\?/);
        return results[0].replace(/objects\/|\/.\?$/, '');
    }
    else {
       return null;
    }
}

function extractQueryName(txt){
    if (txt.match(/query\/data\/[a-zA-z0-9\\-]\?/)){
        var results = txt.exec(/query\/data\/[a-zA-z0-9\\-]\?/);
        return results[0].replace(/query\/data\/|\?$/, '');
    }
    else{
        return null;
    }
}

function extractActionName(txt){
    if (txt.match(/objects\/action\/[a-zA-z0-9]\?/)){
        var results = txt.exec(/\?name\=.[\&]?/);
        return results[0].replace(/\?name=|\&./g, '');
    }
    else if (txt.match(/objects\/action\/.\/[a-zA-z0-9\_]\?/)){
        var results = txt.exec(/\?name\=.[\&]?/);
        return results[0].replace(/\?name=|\&.*/, '');
    }
    else{
        return null;
    }
}

function fetchLoggingApps(callback){
    var headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }

    request(
        {
            url: loggingPlanUrl,
            headers: headers,
            method: 'GET'
        },

        function (error, response, body) {
            // console.log(error);
            // console.log(body);
            // console.log(response.statusCode);
            if (!error && response.statusCode == 200) {
               syncLoggingApps(body, function(err){
                    if (!err){
                        logger.logFields(true, null, "regular", "schema server", "fetchLoggingApps", "success");   
                    }
                    else{
                        logger.logFields(true, null, "exception", "schema server", "fetchLoggingApps", util.format("%s %j", "sync error", err), null);
                    }
               });
            }
            else{
                logger.logFields(true, null, "exception", "schema server", "fetchLoggingApps", util.format("%s %j %d", "logginPlanUrl error", error, response.statusCode), null);
            }
            callback();
        }
    );
}

// data should have structure of array of 
// appName
// bucketName
// accessKeyId
// secretAccessKey
function syncLoggingApps(data, callback) {

    
    var apps = _.pick(data, "appName");
    var oldApps = [];
    var toBeDeletedApps = [];
    var newApps = [];

    async.series({
        members: function(callback) {
            redisDataSource.setMemebers(redisKeys.loggingPlanApps, function(err, data){
                if (!err){
                    oldApps = data;
                    toBeDeletedApps = _.difference(oldApps, apps);
                    newApps = _.difference(apps, oldApps);
                    callback(null);
                }
                else{
                    callback(err);
                }
            });
        },
        deleteOmittedApps: function(callback) {
            async.eachOf(toBeDeletedApps, 
                function (value, cb) {
                    redisDataSource.removeAppForLogging(value, cb)
                },
                function(err){
                    callback(err);
                }
            );
        },
        addNewApps: function(callback){
            async.eachOf(newApps, 
                function (value, cb) {
                    redisDataSource.addAppForLogging(value.appName, _.omit(value, "appName"), cb);
                },
                function(err){
                    callback(err);
                }
            );
        }
    }, 
    function(err) {
        callback(err);
    });
}

async.series(
    {
        syncLoggingApps: function(callback){
            // fetchLoggingApps(callback);
            callback(null);
        },

        runHttpServer: function(callback){
            require('http').createServer(function (request, response) {
                logger.logFields(true, null, "regular", "schema server", null, 'start server on port 9000 ' + version);
                var body = "";

                request.addListener('data', function (chunk) {
                    body += chunk
                });
                request.addListener('end', function () {
                    //
                    // Dispatch the request to the router
                    //
                    router.handle(request, body, function (result) {
                        try{
                            response.writeHead(result.status, result.headers);
                        }
                        catch (err){
                            try {
                                if (result.headers && result.headers.error){
                                    if (!_.isString(result.headers.error)){
                                        try{
                                            result.headers.error = JSON.stringify(result.headers.error);
                                        }
                                        catch(err){
                                            result.headers.error = '';
                                        }
                                    }
                                    result.headers.error = result.headers.error.replace(/(\r\n|\n|\r)/gm,"");
                                    response.writeHead(result.status, result.headers);
                                }
                                else {
                                    response.writeHead(result.status);    
                                }
                            }
                            catch (err2){
                                response.writeHead(result.status);
                            }
                        }
                        response.end(result.body);
                    });
                });
            }).listen(9000);
            callback();
        }
    },

    function(err, results) {
        if (!err){
            logger.logFields(true, null, "regular", "schema server", null, "start with config " + config.env);
        }
        else{
            logger.logFields(true, null, "exception", "schema server", null, "failed to start");
        }
    }
);

// setInterval(fetchLoggingApps, 24 * 60 * 60 * 1000);

function getToken(headers) {
    if (headers.Authorization || headers.authorization) {
        var authInfo = headers.Authorization;
        if (!authInfo) {
            authInfo = headers.authorization;
        }
        var tokenStructure = authInfo.split(" ");
        return tokenStructure;
    }
    else {
        return null;
    }
}

