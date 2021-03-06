var AWS = require('aws-sdk')
var config = require('../configFactory').getConfig();


function deleteLambdaFunctionFromS3(folder, functionName, callback){
  var lambda = new AWS.Lambda(config.AWSDefaultConfig);
  var params = {
    FunctionName: functionName, /* required */
    // Qualifier: 'STRING_VALUE'
  };
  lambda.deleteFunction(params, function(err, data) {
    if (err) console.error(err, err.stack); // an error occurred
    else     console.log(data);           // successful response
    callback(err, data);
  });

}

module.exports.deleteLambdaFunctionFromS3 = deleteLambdaFunctionFromS3;