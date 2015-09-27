'use strict';

var https = require('https');
var urlModule = require('url');
var querystring = require('querystring');
var fs = require('fs');
var os = require('os');
var st = require('st');
var auth = require('basic-auth');
var crypto = require('crypto');
var ExifImage = require('exif').ExifImage;
var vcgencmd = require('vcgencmd');
var diskusage = require('diskusage');

var config = {
    username: 'timelapse',
    password: 'timelapse',
    capturePath: __dirname + '/../capture'
}

var serverOptions = {
    key: fs.readFileSync(__dirname + '/config/timelapse.key'),
    cert: fs.readFileSync(__dirname + '/config/timelapse.crt')
};

var mounts = [st({
    path: __dirname + '/node_modules/bootstrap/dist',
    url: '/bootstrap'
}), st({
    path: __dirname + '/node_modules/jquery/dist',
    url: '/jquery'
}), st({
    path: __dirname + '/webapp',
    index: 'index.html'
})];

var previewImage = null;
var previewImageHash = null;
var previewImageInfo = null;

function updatePreviewImage() {
    var previewImageName = config.capturePath + '/latest.jpg';

    function onError(err) {
        previewImage = null;
        previewImageHash = null;
        previewImageInfo = null;
    }

    fs.stat(previewImageName, function (err, stat) {
        if (err) return onError(err);

        var newHash = crypto.createHash('md5').
            update('' + stat.mtime + '#' + stat.size).
            digest('hex');

        if (newHash === previewImageHash) return;

        try {
            new ExifImage({image: previewImageName}, function (err, exifData) {
                if (err) return onError(err);

                fs.open(previewImageName, 'r', function (err, fd) {
                    if (err) return onError(err);

                    var offset = exifData.thumbnail.ThumbnailOffset + 12; // see https://github.com/gomfunkel/node-exif/issues/31
                    var length = exifData.thumbnail.ThumbnailLength;
                    var thumbnail = new Buffer(length);

                    fs.read(fd, thumbnail, 0, length, offset, function (err) {
                        fs.close(fd);
                        if (err) return onError(err);

                        // Thumbnail is padded to 24KB by raspistill - remove 0x00 bytes at the end:
                        var length = thumbnail.length;
                        while (length > 0 && thumbnail[length - 1] === 0) length--;
                        thumbnail = thumbnail.slice(0, length);

                        previewImage = thumbnail;
                        previewImageHash = newHash;
                        previewImageInfo = stat.mtime.toISOString().replace('T', ' ').replace(/\..*/, '') +
                            ' (' + formatBytes(stat.size) + ')';
                    });
                });
            });
        } catch (err) {
            onError(err);
        }
    });
}

setInterval(updatePreviewImage, 1000);
updatePreviewImage();

var status = {
    isCapturing: false,
    latestPictureHash: null,
    captureMode: {title: 'Capture Mode', value: 'unknown', type: 'default'},
    latestPicture: {title: 'Latest Picture', value: 'unknown', type: 'default'},
    freeDiskSpace: {title: 'Free Disk Space', value: 'unknown', type: 'default'},
    cpuTemp: {title: 'CPU Temperature', value: 'unknown', type: 'default'},
    systemLoad: {title: 'System Load', value: 'unknown', type: 'default'},
    uptime: {title: 'Uptime', value: 'unknown', type: 'default'}
};

function updateStatus(partial) {
    status.latestPictureHash = previewImageHash;

    status.latestPicture.value = previewImage ? previewImageInfo : '(none)';
    status.latestPicture.type = previewImage ? 'success' : 'danger';

    if (!partial) {
        if (!vcgencmd.getCamera().detected) {
            status.captureMode.value = 'No camera detected';
            status.captureMode.type = 'danger';
        } else {
            status.captureMode.value = 'unknown';
            status.captureMode.type = 'default';
        }

        diskusage.check(config.capturePath, function(err, info) {
            if (err) {
                status.freeDiskSpace.value = 'error';
                status.freeDiskSpace.type = 'danger';
                return;
            }

            var freePercent = Math.round(info.free / info.total * 10) * 10;
            status.freeDiskSpace.value = formatBytes(info.free) + ' (' + freePercent + ' %)';
            status.freeDiskSpace.type = freePercent < 10 ? (freePercent < 3 ? 'danger' : 'warning') : 'success';
        });

        var cpuTemp = vcgencmd.measureTemp();
        status.cpuTemp.value = '' + cpuTemp + '°C';
        status.cpuTemp.type = cpuTemp >= 65 ? (cpuTemp >= 75 ? 'danger' : 'warning') : 'success';
    }

    var systemLoad = os.loadavg();
    status.systemLoad.value = systemLoad.map(function (load) {return load.toFixed(2);}).join(' - ');
    status.systemLoad.type = systemLoad[0] >= 2 ? (systemLoad[0] >= 5 ? 'danger' : 'warning') : 'success';

    var uptime = os.uptime();
    var days = Math.floor(uptime / (3600 * 24)); uptime -= days * (3600 * 24);
    var hours = Math.floor(uptime / 3600); uptime -= hours * 3600;
    var minutes = Math.floor(uptime / 60); uptime -= minutes * 60;
    var seconds = uptime;
    status.uptime.value = (days > 0 ? days + 'd ' : '') +
        pad(hours, 2) + ':' + pad(minutes, 2) + ':' + pad(seconds, 2);

    function pad(num, size) {
        var str = '' + num;
        if (str.length < size) {
            str = new Array(size - str.length + 1).join('0') + str;
        }
        return str;
    }
}

setInterval(updateStatus, 10000);
updateStatus();

function formatBytes(bytes) {
    var unit = 'B', units = ['KB', 'MB', 'GB'];

    for (var i = 0; i < units.length; i++) {
        if (bytes < 1024) break;
        bytes /= 1024;
        unit = units[i];
    }
    return bytes.toFixed(2) + ' ' + unit;
}

var apiActions = {
    startCapture: function (data, callback) {
        callback({error: 'Action startCapture not implemented'}, 501);
    },
    stopCapture: function (data, callback) {
        callback({error: 'Action stopCapture not implemented'}, 501);
    },
    loadStatus: function (data, callback) {
        updateStatus(true);
        callback(status, 200);
    },
    loadConfig: function (data, callback) {
        callback({error: 'Action loadConfig not implemented'}, 501);
    },
    saveConfig: function (data, callback) {
        callback({error: 'Action saveConfig not implemented'}, 501);
    },
    unknown: function (data, callback) {
        callback({error: 'Unknown API-Action'}, 404);
    }
};

https.createServer(serverOptions, function (request, response) {
    var startTime = process.hrtime();
    var credentials = auth(request);

    if (!credentials || credentials.name !== config.username || credentials.pass !== config.password) {
        response.writeHead(401, {
            'WWW-Authenticate': 'Basic realm="RaspiCam-Timelapse"'
        });
        response.end('Access denied');
        return;
    }

    var url = urlModule.parse(request.url);

    if (url.pathname === '/api.php') {
        var query = querystring.parse(url.query);
        var action = query.action;
        var requestData = null; // TODO: process POST data

        if (!apiActions[action]) action = 'unknown';

        apiActions[action](requestData, function (data, statusCode) {
            var json = JSON.stringify(data);
            var duration = process.hrtime(startTime);

            response.writeHead(statusCode || 200, {
                'Content-Type': 'application/json',
                'X-Duration': Math.round((duration[0] * 1000 + duration[1] / 1000000) * 10) / 10
            });
            response.end(json);
        });
        return;
    }

    if (url.pathname === '/preview.php') {
        if (!previewImage) {
            response.writeHead(404);
            response.end('No preview image available');
            return;
        }

        response.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'must-revalidate',
            'Expires': '0'
        });
        response.end(previewImage);
        return;
    }

    // serve static files:
    for (var i = 0; i < mounts.length; i++) {
        if (mounts[i](request, response)) break;
    }
}).listen(4443);
