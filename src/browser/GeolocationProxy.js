/*
 * Copyright 2013 Research In Motion Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* global Windows, WinJS */
var PositionError = require('./PositionError');
var {Geolocator, GeolocationAccessStatus, PositionStatus, PositionAccuracy} = require('@nodert-win10-rs4/windows.devices.geolocation');
var callbacks = {};
var locs = {};

// constants
var FALLBACK_EPSILON = 0.001;

function ensureAndCreateLocator () {
    var deferral;

    var loc = new Geolocator();

    if (typeof Geolocator.requestAccessAsync === 'function') {
        deferral = Geolocator.requestAccessAsync().then(function (result) {
            if (result === GeolocationAccessStatus.allowed) {
                return loc;
            }

            return Promise.reject({
                code: PositionError.PERMISSION_DENIED,
                message: 'Geolocation access has not been allowed by user.'
            });
        });
    } else {
        deferral = WinJS.Promise.wrap(loc);
    }

    return deferral;
}

function createErrorCode (loc) {
    /* eslint-disable no-fallthrough */
    switch (loc.locationStatus) {
        case PositionStatus.initializing:
        // This status indicates that a location device is still initializing
        case PositionStatus.noData:
        // No location data is currently available
        case PositionStatus.notInitialized:
        // This status indicates that the app has not yet requested
        // location data by calling GetGeolocationAsync() or
        // registering an event handler for the positionChanged event.
        case PositionStatus.notAvailable:
            // Location is not available on this version of Windows
            return PositionError.POSITION_UNAVAILABLE;

        case PositionStatus.disabled:
            // The app doesn't have permission to access location,
            // either because location has been turned off.
            return PositionError.PERMISSION_DENIED;

        default:
            break;
    }
}
/* eslint-enable no-fallthrough */
function createResult (pos) {
    var res = {
        accuracy: pos.coordinate.accuracy,
        heading: pos.coordinate.heading,
        velocity: pos.coordinate.speed,
        altitudeAccuracy: pos.coordinate.altitudeAccuracy,
        timestamp: pos.coordinate.timestamp
    };

    if (pos.coordinate.point) {
        res.latitude = pos.coordinate.point.position.latitude;
        res.longitude = pos.coordinate.point.position.longitude;
        res.altitude = pos.coordinate.point.position.altitude;
    } else { // compatibility with old windows8.0 api
        res.latitude = pos.coordinate.latitude;
        res.longitude = pos.coordinate.longitude;
        res.altitude = pos.coordinate.altitude;
    }

    return res;
}

module.exports = {
    getLocation: function (success, fail, args, env) {
        ensureAndCreateLocator().done(function (loc) {
            if (loc) {
                var highAccuracy = args[0];
                var maxAge = args[1];

                loc.desiredAccuracy = highAccuracy ?
                    PositionAccuracy.high :
                    PositionAccuracy.default;

                loc.reportInterval = maxAge || 0;

                loc.getGeopositionAsync().then(
                    function (pos) {
                        success(createResult(pos));
                    },
                    function (err) {
                        fail({
                            code: createErrorCode(loc),
                            message: err.message
                        });
                    }
                );
            } else {
                fail({
                    code: PositionError.POSITION_UNAVAILABLE,
                    message: 'You do not have the required location services present on your system.'
                });
            }
        }, fail);
    },

    addWatch: function (success, fail, args, env) {
        ensureAndCreateLocator().done(function (loc) {
            var clientId = args[0];
            var highAccuracy = args[1];

            var onPositionChanged = function (loc, e) {
                success(createResult(e.position), { keepCallback: true });
            };

            var onStatusChanged = function (loc, e) {
                switch (e.status) {
                    case PositionStatus.noData:
                    case PositionStatus.notAvailable:
                        fail({
                            code: PositionError.POSITION_UNAVAILABLE,
                            message: 'Data from location services is currently unavailable or you do not have the required location services present on your system.'
                        });
                        break;

                    case PositionStatus.disabled:
                        fail({
                            code: PositionError.PERMISSION_DENIED,
                            message: 'Your location is currently turned off.'
                        });
                        break;

                    // case Windows.Devices.Geolocation.PositionStatus.initializing:
                    // case Windows.Devices.Geolocation.PositionStatus.ready:
                    default:
                        break;
                }
            };

            loc.desiredAccuracy = highAccuracy ?
                PositionAccuracy.high :
                PositionAccuracy.default;

            if (cordova.platformId === 'browser') { // eslint-disable-line no-undef
                // 'positionchanged' event fails with error below if movementThreshold is not set
                // JavaScript runtime error: Operation aborted
                // You must set the MovementThreshold property or the ReportInterval property before adding event handlers.
                // WinRT information: You must set the MovementThreshold property or the ReportInterval property before adding event handlers
                if (Number.EPSILON) {
                    loc.movementThreshold = Number.EPSILON;
                } else {
                    loc.movementThreshold = FALLBACK_EPSILON;
                }
            }

            loc.addListener('PositionChanged', onPositionChanged);
            loc.addListener('StatusChanged', onStatusChanged);

            callbacks[clientId] = { pos: onPositionChanged, status: onStatusChanged };
            locs[clientId] = loc;
        }, fail);
    },

    clearWatch: function (success, fail, args, env) {
        var clientId = args[0];
        var callback = callbacks[clientId];
        var loc = locs[clientId];

        if (callback && loc) {
            loc.removeListener('PositionChanged', callback.pos);
            loc.removeListener('StatusChanged', callback.status);

            delete callbacks[clientId];
            delete locs[clientId];
        }

        success();
    }
};

require('cordova/exec/proxy').add('Geolocation', module.exports);
