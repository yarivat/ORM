var request = require('request');
var async = require('async');
var _ = require('underscore');

var email = "kornatzky@me.com";
var password = "secret";
var appName = "r";

var tokenUrl = "https://api.backand.com:8080/token";
var tableUrl = "https://api.backand.com:8080/1/table/config/";
var columnsUrl = "https://api.backand.com:8080/1/table/config/";
var backandToJsonType = {
	"Numeric": "float",
	"ShortText": "string",
	"LongText": "text",
	"Boolean": "boolean",
	"Binary": "binary",
	"DateTime": "datetime"
};

// get token
request(

	{
	    url: tokenUrl,
	    
	    method: 'POST',
	   
	    form: {
	        username: email,
	        password: password,
	        appname: appName,
	        grant_type: "password"
	    }
	}, 

	function(error, response, body){	
	    if(!error && response.statusCode == 200) {
	    	var b = JSON.parse(body)
	    	var accessToken = b["access_token"];
	    	var tokenType = b["token_type"];
	    	fetchTables(accessToken, tokenType);
	    }
	    else{
	    	console.log("cannot get token", error, response.statusCode);
	    	process.exit(1);
	    }
	}

);

function fetchTables(accessToken, tokenType){
	
	request(

		{
		    url: tableUrl,

		    headers: {
		    	'Accept': 'application/json', 
		        'Content-Type': 'application/json',
		        'Authorization': tokenType + " " + accessToken
		    },
		    
		    method: 'GET',

		    qs: {
		        filter: '[{fieldName:"SystemView", operator:"equals", value: false}]',
		        sort: '[{fieldName:"order", order:"asc"}]'
		    }
		},

		function(error, response, body){	
		    if(!error && response.statusCode == 200) {
		    	var body = JSON.parse(body);
		    	if (body.totalRows > 0){

		    		async.map(body.data, 
		    			function(item, callback){
		    				var relationName = item.name;
		    				fetchColumns(accessToken, tokenType, relationName, callback);
		    			},
		    			function(err, results){

		    				var tables = _.filter(results, function(r){
		    					return r;
		    				})
		    				console.log("database", JSON.stringify(tables));
		    				// transform tables to create relationships
		    				process.exit(1);
		    			}
		    		);
		    	}
		    	
		    }
		    else{
		    	console.log("cannot get tables", error, response.statusCode);
		    	process.exit(1);
		    }
		}

	);
}

function fetchColumns(accessToken, tokenType, tableName, callbackColumns){

	request(

		{
		    url: columnsUrl + tableName,

		    headers: {
		    	'Accept': 'application/json', 
		        'Content-Type': 'application/json',
		        'Authorization': tokenType + " " + accessToken
		    },
		    
		    method: 'GET'
		},

		function(error, response, body){	
		    if(!error && response.statusCode == 200) {
		    	
		    	var body = JSON.parse(body);
		    	console.log(body.fields);
	    		async.map(body.fields, 
	    			function(item, callback){
	    				
	    				var description = { name: item.name, type: backandToJsonType[item.type] };
	    				if (item.required)
	    					description.required = true;
	    				// if (_.has(item, "minValue"))
	    				// 	description.minValue = item.minValue;
	    				// if (_.has(item, "maxValue"))
	    				// 	description.maxValue = item.maxValue;
	    				if (_.has(item, "defaultValue"))
	    					description.defaultValue = item.defaultValue;
	    				callback(null, description);
	    			},
	    			function(err, results){
	    				var attributes = _.object(_.pluck(results, "name"), _.map(results, function(c){ return _.omit(c, "name"); }));
	    				callbackColumns(null, { name: tableName, attributes: attributes });
	    			}
	    		);
		    	
		    }
		    else{
		    	console.log("cannot get tables", error, response.statusCode);
		    	callback(error ? error : response.statusCode, null);
		    }
		}

	);

}