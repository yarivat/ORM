var socket = require('socket.io-client')('http://yariv-495407567.us-east-1.elb.amazonaws.com');

	//QA-Socket-1441320464.us-east-1.elb.amazonaws.com:80');

socket.on('connect', function(){
    console.log('connected four');
    var r = Math.random();
	socket.emit('clientMessage', 'four ' + r);
});

socket.on('disconnect', function(){
    console.log('disconnect');
});

socket.on('reconnecting', function(){
    console.log('reconnecting');
});

socket.on('reconnect', function(){
    console.log('reconnect');
    var r = Math.random();
	socket.emit('clientMessage', 'four ' + r);
});

socket.on('error', function(error){
    console.log('error', error);
});

socket.on('serverMessage', function(data){
	console.log('echo four:', data);
});


