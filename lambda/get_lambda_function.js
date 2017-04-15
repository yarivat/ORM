var AWS = require('aws-sdk');
var http = require('http');
var fs = require('fs');

function getLambdaFunction(awsRegion, accessKeyId, secretAccessKey, functionName, callback){
  AWS.config.update({ 'accessKeyId': accessKeyId, 'secretAccessKey': secretAccessKey, 'region': awsRegion });
  var lambda = new AWS.Lambda();
  var params = {
    FunctionName: functionName
  };
  lambda.getFunction(params, function(err, data) {
    if (err) {
      console.log(err, err.stack); // an error occurred
      callback(err);
    }
    else {  
      /*
      { 
        Configuration: 
         { 
           FunctionName: 'testlambda_items_jhjk',
           FunctionArn: 'arn:aws:lambda:us-east-1:328923390206:function:testlambda_items_jhjk',
           Runtime: 'nodejs',
           Role: 'arn:aws:iam::328923390206:role/lambda_control',
           Handler: 'handler.handler',
           CodeSize: 1434,
           Description: '',
           Timeout: 3,
           MemorySize: 128,
           LastModified: '2016-04-21T14:25:04.677+0000',
           CodeSha256: 'BQzc43yud2hsU3Di+DG70x38trDcaquN9UG+g71PVng=',
           Version: '$LATEST',
           VpcConfig: { SubnetIds: [], SecurityGroupIds: [], VpcId: null },
           KMSKeyArn: null },
        Code: 
         { 
           RepositoryType: 'S3',
           Location: 'https://prod-04-2014-tasks.s3.amazonaws.com/snapshots/328923390206/testlambda_items_j...'
          } 
      }
     */  
      callback(err, data);
    }
    
  }); 
}

module.exports.getLambdaFunction = getLambdaFunction;

// getLambdaFunction('us-east-1', "AKIAJQIZGYS3N4IPFCVA", "VY4DmqWHeWNPmR9et9EP8+cLHKq2aNvucH36ltcx", "testlambda_items_jhjk", function(err, data){
//   console.log("=======");
//   console.log(err);
//   console.log(data);
//   process.exit(1);
// });