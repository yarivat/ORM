var _ = require('underscore');
var TAFFY = require('taffy');
var knex = require('knex')({
  client: 'mysql'
});

// var s = knex.schema.createTable('users', function (table) {
//   table.increments();
//   var column = table.string('name');
//   // console.log(column);
// //  column.notNullable(); 
//   table.timestamps();
// });
// console.log(s.toString());

// process.exit(1);


// oldSchema - json
// newSchema - json

// severity - 
// 0 validate transform based on schemes only
// 1 validate transform based on schemes and current data 

/* returns: json
 
 {  
    valid: string - "always" - perfectly valid, "data" - valid with warnings, depends on actual data, "never" - invalid,
	warning: <array of strings of warnings/errors>
    alter: <array of strings of SQL statements to alter schema>
  }
*/

// warnings

var columnTypeConflict = "column type conflict";

// table of types that can allow for alter, e.g. int to float, varchar(x) to varchar(y) if y > x 

var validTransformDegree = TAFFY([

	{ from: "string", to: "string", degree: "always"},
	{ from: "string", to: "text", degree: "data"},
	{ from: "string", to: "integer", degree: "data"},
	{ from: "string", to: "float", degree: "data"},
	{ from: "string", to: "date", degree: "data"},
	{ from: "string", to: "time", degree: "data"},
	{ from: "string", to: "datetime", degree: "data"},
	{ from: "string", to: "boolean", degree: "never"},
	{ from: "string", to: "binary", degree: "never"}, 

	{ from: "text", to: "string", degree: "data"},
	{ from: "text", to: "text", degree: "always"},
	{ from: "text", to: "integer", degree: "data"},
	{ from: "text", to: "float", degree: "data"},
	{ from: "text", to: "date", degree: "data"},
	{ from: "text", to: "time", degree: "data"},
	{ from: "text", to: "datetime", degree: "data"},
	{ from: "text", to: "boolean", degree: "never"},
	{ from: "text", to: "binary", degree: "never"},

	{ from: "integer", to: "string", degree: "always"},
	{ from: "integer", to: "text", degree: "always"},
	{ from: "integer", to: "integer", degree: "always"},
	{ from: "integer", to: "float", degree: "always"},
	{ from: "integer", to: "date", degree: "never"},
	{ from: "integer", to: "time", degree: "never"},
	{ from: "integer", to: "datetime", degree: "never"},
	{ from: "integer", to: "boolean", degree: "data"},
	{ from: "integer", to: "binary", degree: "always"},

	{ from: "float", to: "string", degree: "always"},
	{ from: "float", to: "text", degree: "always"},
	{ from: "float", to: "integer", degree: "always"},
	{ from: "float", to: "float", degree: "always"},
	{ from: "float", to: "date", degree: "never"},
	{ from: "float", to: "time", degree: "never"},
	{ from: "float", to: "datetime", degree: "never"},
	{ from: "float", to: "boolean", degree: "never"},
	{ from: "float", to: "binary", degree: "always"},

	{ from: "date", to: "string", degree: "always"},
	{ from: "date", to: "text", degree: "always"},
	{ from: "date", to: "integer", degree: "never"},
	{ from: "date", to: "float", degree: "never"},
	{ from: "date", to: "date", degree: "always"},
	{ from: "date", to: "time", degree: "never"},
	{ from: "date", to: "datetime", degree: "always"},
	{ from: "date", to: "boolean", degree: "never"},
	{ from: "date", to: "binary", degree: "never"},

	{ from: "time", to: "string", degree: ""},
	{ from: "time", to: "text", degree: ""},
	{ from: "time", to: "integer", degree: ""},
	{ from: "time", to: "float", degree: ""},
	{ from: "time", to: "date", degree: ""},
	{ from: "time", to: "time", degree: ""},
	{ from: "time", to: "datetime", degree: ""},
	{ from: "time", to: "boolean", degree: ""},
	{ from: "time", to: "binary", degree: ""},

	{ from: "datetime", to: "string", degree: "string"},
	{ from: "datetime", to: "text", degree: "string"},
	{ from: "datetime", to: "integer", degree: "never"},
	{ from: "datetime", to: "float", degree: "never"},
	{ from: "datetime", to: "date", degree: "always"},
	{ from: "datetime", to: "time", degree: "never"},
	{ from: "datetime", to: "datetime", degree: "always"},
	{ from: "datetime", to: "boolean", degree: "never"},
	{ from: "datetime", to: "binary", degree: "never"},

	{ from: "boolean", to: "string", degree: "always"},
	{ from: "boolean", to: "text", degree: "always"},
	{ from: "boolean", to: "integer", degree: "always"},
	{ from: "boolean", to: "float", degree: "always"},
	{ from: "boolean", to: "date", degree: "never"},
	{ from: "boolean", to: "time", degree: "never"},
	{ from: "boolean", to: "datetime", degree: "never"},
	{ from: "boolean", to: "boolean", degree: "always"},
	{ from: "boolean", to: "binary", degree: "always"},

	{ from: "binary", to: "string", degree: "never"},
	{ from: "binary", to: "text", degree: "never"},
	{ from: "binary", to: "integer", degree: "never"},
	{ from: "binary", to: "float", degree: "never"},
	{ from: "binary", to: "date", degree: "never"},
	{ from: "binary", to: "time", degree: "never"},
	{ from: "binary", to: "datetime", degree: "never"},
	{ from: "binary", to: "boolean", degree: "never"},
	{ from: "binary", to: "binary", degree: "never"}
]);



var escalationTable = TAFFY([
	{ current: "always", change: "data", next: "data" },
	{ current: "always", change: "never", next: "never" },
	{ current: "always", change: "always", next: "always" },
	{ current: "data", change: "data", next: "data" },
	{ current: "data", change: "never", next: "never" },
	{ current: "data", change: "always", next: "data" },
	{ current: "never", change: "data", next: "never" },
	{ current: "never", change: "never", next: "never" },
	{ current: "never", change: "always", next: "never" },
]);



// var r = transform(
// [

// 	{

// 		name: "S",


// 		attributes: {
// 			C: {
// 				type: "integer"
// 			},

// 			D: {
// 				type: "string",
// 				required: true
// 			}
// 		}
// 	},

// 	{

// 		name: "U",


// 		attributes: {
// 			E: {
// 				type: "integer"
// 			},

// 			F: {
// 				type: "string",
// 				required: true
// 			},

// 			H: {
// 				type: "string"
// 			}
// 		}
// 	},


// ], 
// [

// 	{
// 		name: "R",

// 		attributes: {
// 			A: {
// 				type: "integer"
// 			},

// 			B: {
// 				type: "string",
// 				required: true
// 			}
// 		}

// 	},

// 	{

// 		name: "U",


// 		attributes: {

// 			F: {
// 				type: "string",
// 				required: true
// 			},

// 			G: {
// 				type: "float"
// 			},

// 			H: {
// 				type: "date"
// 			}
// 		}
// 	},

// ], 1);

// console.log(JSON.stringify(r));

function transform(oldSchema, newSchema, severity){
	console.log(oldSchema, newSchema, severity);

	// Compare the JSON
	var modifications = compareSchemes(oldSchema, newSchema, severity);
    console.log(JSON.stringify(modifications));
	// Determine validity 
	var validity = isValidTransformation(oldSchema, newSchema, modifications);
	console.log(validity);


	if (severity == 0 && validity.valid != "always"){
		return validity;
	}
	else if (severity == 1 && validity.valid == "never"){
		return validity;
	}
	console.log("construct");

	// Construct an array of the required changes between schemes
	var alterStatementsArray = createStatements(oldSchema, newSchema, modifications);

	// describe the order of the database
	var tablesOrder = _.pluck(newSchema, "name");
	var columnsOrder = _.map(newSchema, function(t){
		return _.keys(t.attributes);
	});
	console.log(columnsOrder);
	var orderStructure = { tables: tablesOrder, columns: _.object(tablesOrder, columnsOrder) };
	
	return _.extend(validity, { alter: alterStatementsArray, order: orderStructure });

}

function compareRelationSets(oldDb, newDb){
	
	var oldRelationNames = _.pluck(oldDb, "name");
	var newRelationNames = _.pluck(newDb, "name");
	var droppedRelationNames = _.difference(oldRelationNames, newRelationNames);
	var addedRelationNames = _.difference(newRelationNames, oldRelationNames);
	var existingRelationNames = _.intersection(oldRelationNames, newRelationNames);
	return { dropTable: droppedRelationNames, createTable: addedRelationNames, commonTables: existingRelationNames };

}

function compareSchemes(oldSchema, newSchema) {
	var databaseModifications = compareRelationSets(oldSchema, newSchema);

	var relationsModifications = [];
	// for each relation that existed before and after
	_.each(databaseModifications.commonTables, function(c){
		var relationModification = compareRelationSchemes(_.first(_.where(oldSchema, { name: c })), _.first(_.where(newSchema, { name: c })));
		if (relationModification){
			relationsModifications.push(relationModification);
		}
	});

	return _.extend(databaseModifications, {  modifiedTables: relationsModifications });
	
	
}

function compareRelationSchemes(oldRelation, newRelation){
	console.log("compareRelationSchemes", oldRelation, newRelation);

	// For the same relation R, in the two schemes, compare the set of column names
	// Obtain set of column add and column drop changes
	var oldColumnNames = _.keys(oldRelation.attributes);
	var newColumnNames = _.keys(newRelation.attributes);
	console.log("oldColumnNames", JSON.stringify(oldColumnNames), "newColumnNames", JSON.stringify(newColumnNames));
	var droppedColumnNames = _.difference(oldColumnNames, newColumnNames);
	console.log("droppedColumnNames", droppedColumnNames);
	var addedColumnNames = _.difference(newColumnNames, oldColumnNames);
	console.log("addedColumnNames", addedColumnNames);
	var existingColumnNames = _.intersection(oldColumnNames, newColumnNames);
	console.log("existingColumnNames", existingColumnNames);

	// obtain set of column modifications
	var modifiedColumns = [];
	_.each(existingColumnNames, function(column){
		var typeHasChanged = oldRelation.attributes[column].type != newRelation.attributes[column].type;
		var requiredHasChanged =  oldRelation.attributes[column].required ? !newRelation.attributes[column].required : newRelation.attributes[column].required;
		if (typeHasChanged || requiredHasChanged){
			modifiedColumns.push(column);
		}
	});

	return {
		name: oldRelation.name, dropped: droppedColumnNames, added: addedColumnNames, modified: modifiedColumns
	};

}

function isValidTransformation(oldSchema, newSchema, modifications){

	
	// table add is valid

	// table drop is valid if not involved in relationship

	var warnings = [];
	var invalid = "always";

	// common tables
	_.each(modifications.modifiedTables, function(modifiedRelation){
		var relationName = modifiedRelation.name;
		var modifiedColumns = modifiedRelation.modified;

		_.each(modifiedColumns, function(column){
			var oldRelation = _.first(_.where(oldSchema, { name: relationName }));
			var newRelation = _.first(_.where(newSchema, { name: relationName }));
			console.log(oldRelation, newRelation);
			var oldColumnType = oldRelation.attributes[column].type;
			var newColumnType = newRelation.attributes[column].type;
			if (oldColumnType !=  newColumnType){
				var conformityDegree = validTypeTransform(oldColumnType, newColumnType);
				switch(conformityDegree)
				{
					case "never":
						warnings.push({ kind: columnTypeConflict, relation: relationName, column: column, oldType: oldColumnType, newType: newColumnType });
						invalid = escalateValidity(invalid, "never");
					break;

					case "data":
						warnings.push({ kind: columnTypeConflict, relation: relationName, column: column, oldType: oldColumnType, newType: newColumnType });
						invalid = escalateValidity(invalid, "data");
					break;

					default:
					break;
				}


			}
		});

		// column drop is valid unless involved in relationship
		var droppedColumns = modifiedRelation.dropped;

		// column add is always valid

	});
	var v = { valid: invalid, warnings: warnings };
	console.log("isValidTransformation", v);
	return v;
	
}




function escalateValidity(oldValidity, changeValidity){
	var tuple = escalationTable({ current: oldValidity, change: changeValidity }).first();
	if (tuple){
		return tuple.next;
	}
	return "never";
}



function validTypeTransform(oldColumnType, newColumnType){
	console.log("validTypeTransform", oldColumnType, newColumnType);
	var tuple = validTransformDegree({ from: oldColumnType, to: newColumnType }).first();
	console.log("tuple", tuple);
	if (tuple){
		return tuple.degree;
	}
	return "never";
}

// Transform the array of required changes into SQL alter statements
function createStatements(oldSchema, newSchema, modifications){

	var statements = [];


	// drop tables
	var droppedTables = modifications.dropTable;
	_.each(droppedTables, function(t){
		var statement = knex.schema.dropTable(t);
		statements.push(statement.toString());
	});
	console.log("delete table", statements);

	// add tables
	var addedTables = modifications.createTable;
	_.each(addedTables, function(t){
		var statement = knex.schema.createTable(t, function (table) {
		  table.increments();
		  table.timestamps();

		  var newTableSchema = _.findWhere(newSchema, { name: t });
		  _.each(newTableSchema.attributes, function(description, name){
		  	switch(description.type){
		  		case "string":
		  			var col = table.string(name);
		  			if (description.required){
		  				col.notNullable();
		  			}
		  		break;
		  		case "text":
		  			var col = table.text(name);
		  			if (description.required){
		  				col.notNullable();
		  			}
		  		break;
		  		case "integer":
		  			var col = table.integer(name);
		  			if (description.required){
		  				col.notNullable();
		  			}
		  		break;
		  		case "float":
		  			var col = table.float(name);
		  			if (description.required){
		  				col.notNullable();
		  			}
		  		break;
		  		case "date":
		  			table.date(name);
		  			if (description.required){
		  				col.notNullable();
		  			}
		  		break;
		  		case "time":
		  			table.time(name);
		  			if (description.required){
		  				col.notNullable();
		  			}
		  		break;
		  		case "datetime":
		  			table.dateTime(name);
		  			if (description.required){
		  				col.notNullable();
		  			}
		  		break;
		  		case "boolean":
		  			table.boolean(name);
		  			if (description.required){
		  				col.notNullable();
		  			}
		  		break;
		  		case "binary":
		  			table.text(name);
		  			if (description.required){
		  				col.notNullable();
		  			}
		  		break;
		  	}

		  });
		    
		});
		statements.push(statement.toString());
	});
    console.log("add table", statements);

	// modify tables
	var modifiedTables = modifications.modifiedTables;
	console.log("modifiedTables", modifiedTables);
	_.each(modifiedTables, function(m){
		var tableName = m.name;
		var tableDescription = _.first(_.where(newSchema, { name: tableName }));
		var statement = knex.schema.table(tableName,function(table){
			_.each(m.dropped, function(d){
				table.dropColumn(d);
			});
			_.each(m.added, function(d){
				var description = tableDescription.attributes[d];
			  	switch(description.type){
			  		case "string":
			  			var col = table.string(d);
			  			if (description.required){
			  				col.notNullable();
			  			}
			  		break;
			  		case "text":
			  			var col = table.text(d);
			  			if (description.required){
			  				col.notNullable();
			  			}
			  		break;
			  		case "integer":
			  			var col = table.integer(d);
			  			if (description.required){
			  				col.notNullable();
			  			}
			  		break;
			  		case "float":
			  			var col = table.float(d);
			  			if (description.required){
			  				col.notNullable();
			  			}
			  		break;
			  		case "date":
			  			table.date(d);
			  			if (description.required){
			  				col.notNullable();
			  			}
			  		break;
			  		case "time":
			  			table.time(d);
			  			if (description.required){
			  				col.notNullable();
			  			}
			  		break;
			  		case "datetime":
			  			table.dateTime(d);
			  			if (description.required){
			  				col.notNullable();
			  			}
			  		break;
			  		case "boolean":
			  			table.boolean(d);
			  			if (description.required){
			  				col.notNullable();
			  			}
			  		break;
			  		case "binary":
			  			table.text(d);
			  			if (description.required){
			  				col.notNullable();
			  			}
			  		break;
			  	}
			});	
		});
		var sArray = statement.toString().replace(";", "").split("\n");
		
		_.each(sArray, function(a){
			statements.push(a);
		});
		console.log("add/drop columns", statements);
		_.each(m.modified, function(d){
			// var oldAttributeDescription = _.first(_.where(newSchema, { name: tableName })).attributes[d];
			var newAttributeDescription = tableDescription.attributes[d];
			var typeClause = "alter table " + tableName + " modify " + d + " " + newAttributeDescription.type;
			var requiredClause = newAttributeDescription.required ? " null " : " not null ";
			var statement = typeClause + requiredClause;
			statements.push(statement);
		});
	});
    console.log("modify table", statements);
    return statements;

}