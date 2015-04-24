Transform
=========
Create SQL script to transform one schema to another.

Call as:

    transform(oldSchema, newSchema, severity)

Obtains two JSON schemes: 

* `oldSchema` - json
* `newSchema` - json

* `severity` - 
    1. 0 - validate transform based on schemes only
    2. 1 - validate transform based on schemes and current data 

Returns: json wih three fields:
 
 
1. valid: string - "always" - perfectly valid, "data" - valid with warnings, depends on actual data, "never" - invalid,
2. warnings: <array of strings of warnings/errors>
3. alter: <array of strings of SQL statements to alter schema>

Validate
========
Test if a JSON schema is valid.

Call as:

    validateSchema(str)

Obtains:

* `str` - string representing schema in JSON 

Returns: json wih two fields:
 
1. valid: boolean
2. warnings: <array of strings of warnings/errors>



