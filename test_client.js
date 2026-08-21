const io = require('socket.io-client');
const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log("Connected");
    socket.emit('creerSalon', 'Test');
});
socket.on('salonCree', (salon) => {
    console.log("Salon cree", salon.id);
    socket.emit('demarrerPartie');
});
socket.on('disconnect', () => {
    console.log("Disconnected, server might have crashed");
});
