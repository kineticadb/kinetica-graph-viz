
"use strict";
function GPUdb(url, options) {
    var urls = (url instanceof Array) ? url : [url];
    var initialIndex = Math.floor(Math.random() * urls.length);
    Object.defineProperty(this, "urls", {
        enumerable: true,
        value: new GPUdb.RingList(urls, initialIndex)
    });
    Object.defineProperty(this, "url", {
        get: function() { return this.urls.getCurrentItem(); },
        enumerable: true
    });

    if (options !== undefined && options !== null) {
        Object.defineProperty(this, "username", {
            enumerable: true,
            value: options.username !== undefined && options.username !== null ? options.username : ""
        });
        Object.defineProperty(this, "password", {
            enumerable: true,
            value: options.password !== undefined && options.password !== null ? options.password : ""
        });
        Object.defineProperty(this, "timeout", {
            enumerable: true,
            value: options.timeout !== undefined && options.timeout !== null && options.timeout >= 0 ? options.timeout : 0
        });
    } else {
        Object.defineProperty(this, "username", { enumerable: true, value: "" });
        Object.defineProperty(this, "password", { enumerable: true, value: "" });
        Object.defineProperty(this, "timeout", { enumerable: true, value: 0 });
    }

    if (this.username !== "" || this.password !== "") {
        Object.defineProperty(this, "authorization", {
            value: "Basic " + btoa(this.username + ":" + this.password)
        });
    } else {
        Object.defineProperty(this, "authorization", { value: "" });
    }
    this._force_infinity_nan_conversion_to_null = false;
    Object.defineProperty( this, "force_infinity_nan_conversion_to_null",
                           {
                               enumerable: true,
                               get: function() { return this._force_infinity_nan_conversion_to_null; },
                               set: function( newValue ) {
                                   if ( [true, false].indexOf( newValue ) == -1 ) {
                                       throw "Value must be true or false"; }
                                   this._force_infinity_nan_conversion_to_null = Boolean( newValue );
                               }
                           } );
    this._protected_headers = ["Accept", "Authorization", "Content-type", "X-Kinetica-Group"];
    this._custom_http_headers = {};
    Object.defineProperty( this, "custom_http_headers",
                           {
                               enumerable: true,
                               get: function() { return this._custom_http_headers; },
                               set: function( value ) {
                                   if ( typeof( value ) !== 'object' ) {
                                       throw "Value must be an object";
                                   }
                                   if ( value === null ) {
                                       return;
                                   }
                                   const headers = Object.keys( value );
                                   headers.forEach( (header, index) => {
                                       if ( this._protected_headers.indexOf( header ) > -1 ) {
                                           throw `Cannot override protected header ${header}`;
                                       }
                                   } );

                                   this._custom_http_headers =  value;
                               }
                           }
                         );
} // end GPUdb
GPUdb.prototype.add_http_header = function( header, value ) {
    if ( ( header === undefined )
         || ( header === null )
         || ( ( typeof header !== 'string' )
              && !(header instanceof String) )
         || (header == "") ) {
        throw `Header ${header} must be a non-empty string!`;
    }
    // The header must be given and be a string (empty strings allowed)
    if ( ( value === undefined )
         || ( value === null )
         || ( ( typeof value !== 'string' )
              && !(value instanceof String) ) ) {
        throw `Value ${value} must be a string!`;
    }
    if ( this._protected_headers.indexOf( header ) > -1 ) {
        throw `Cannot override protected header ${header}`;
    }

    this._custom_http_headers[ header ] = value;
}  // end add_http_header
GPUdb.prototype.remove_http_header = function( header ) {
    if ( this._protected_headers.indexOf( header ) > -1 ) {
        throw `Cannot remove protected header ${header}`;
    }
    if ( header in this._custom_http_headers ) {
        delete this._custom_http_headers[ header ];
    }
}  // end remove_http_header
GPUdb.prototype.get_http_headers = function() {
    return JSON.parse( JSON.stringify( this._custom_http_headers ) );
}  // end get_http_headers
GPUdb.prototype._create_headers = function( http_request,
                                            authorization,
                                            custom_headers ) {
    http_request.setRequestHeader("Content-type", "application/json");
    if (authorization === undefined ) {
        authorization = this.authorization;
    }
    if (custom_headers === undefined ) {
        custom_headers = this._custom_http_headers;
    }
    if (authorization !== "") {
        http_request.setRequestHeader("Authorization", authorization);
    }
    for (let header in custom_headers) {
        http_request.setRequestHeader(header, custom_headers[ header ] );
    }

    return http_request;
}  // end _create_headers
GPUdb.prototype.submit_request = function(endpoint, request, callback) {
    var requestString = JSON.stringify(request);
    var async = callback !== undefined && callback !== null;

    if (async) {
         if (endpoint === "/alter/table" || endpoint === "/alter/table/columns") {
            this.submit_job_request_async(endpoint, requestString, callback);
        }
        else {
            this.submit_request_async(endpoint, requestString, callback);
        }
    }
    else {
        var result = this.submit_request_sync(endpoint, requestString);
        return result;
    }
};
GPUdb.prototype.submit_job_request_async = function(endpoint, requestString, callback) {
    var timeoutInterval = 5000; // 5 seconds

    var initialURL = this.urls.getCurrentItem();

    var urls = this.urls;
    var authorization = this.authorization;
    var timeout = this.timeout;
    var failureCount = 0;
    var custom_headers  = this._custom_http_headers;
    var _create_headers = this._create_headers;
    var failureWrapperCB = function(err, data, url, http, job_id) {
        failureCount += 1;
        if (failureCount < urls.getSize()) {
            // has already advanced the list. Retry using the new head.
            if ( (url !== urls.getCurrentItem()) ||
                 (urls.getNextItem() !== initialURL) )
            {
                if ( (job_id !== undefined) && (job_id !== null) ) {
                    callGetJob( job_id );
                }
                else { // Otherwise, we're trying /create/job still
                    sendInitialRequest();
                }
            }
        }
        else {
            callback(err, data);
        }
    };
    var callGetJob = function( job_id, callback ) {
        var get_job_request = {
            job_id: job_id,
            options: {}
        };
        var get_job_request_string = JSON.stringify( get_job_request );


        var http = new XMLHttpRequest();
        var url = urls.getCurrentItem();
        http.open("POST", url + "/get/job", true);
        _create_headers( http, authorization, custom_headers );

        var timedOut = false;

        http.onloadend = function() {
            parsePreviousCallResponse(http, timedOut, job_id);
        };

        http.ontimeout = function() {
            timedOut = true;
            failureWrapperCB( new Error("Request timed out"), null, url,
                              http, job_id );
        };

        http.timeout = timeout;
        http.send( get_job_request_string );
    };  // end callGetJob
    // (which could be the initial /create/job or a /get/job) and
    // call (which uses itself as a callback)
    var parsePreviousCallResponse = function(http, timedOut, job_id) {
        if (!timedOut)
        {
            var is_create_job_call = false;

            if (http.status === 200 || http.status === 400) {
                try {
                    var response = JSON.parse(http.responseText);
                } catch (e) {
                    callback(new Error("Unable to parse response: " + e), null);
                    return;
                }

                if (response.status === "OK") {
                    try {
                        var data = JSON.parse( response.data_str );
                    } catch (e2) {
                        callback(new Error("Unable to parse response: " + e2), null);
                        return;
                    }
                    if (response.data_type === "create_job_response") {
                        is_create_job_call = true;
                        callGetJob( data.job_id );
                    }
                    else if (response.data_type === "get_job_response") {
                        if (data.successful) {
                            // the callback with the payload of the actual
                            callback( null, JSON.parse( data.job_response_str ) );

                        } else if ( !data.running ) {
                            // then we return an error
                            var error_msg = "";
                            if ( data.job_status === "ERROR" ) {
                                error_msg = ("Error during job execution: "
                                             + data.status_map.error_message );
                            }
                            else if ( data.job_status === "CANCELLED" ) {
                                error_msg = ("Job was cancelled.");
                            }
                            else {
                                error_msg = ("Unknown status: " + data.job_status);
                            }
                            callback( new Error( error_msg ), null );
                        }
                        else {
                            // /get/job in a little bit
                            var call_get_job_again = function() {
                                callGetJob( job_id );
                            };
                            setTimeout( call_get_job_again, timeoutInterval );
                        }
                    }
                    else { // should never get here
                        callback(new Error("Unexpected endpoint response: " + response.data_type), null);
                    }

                } else {
                    callback(new Error(response.message), null);
                }
            } else {
                if (is_create_job_call) {
                    if (http.status === 0) {
                        failureWrapperCB( new Error("Request failed"), null, url );
                    } else {
                        failureWrapperCB( new Error("Request failed with HTTP " + http.status + " (" + http.statusText + ")"), null, url );
                    }
                }
                else {
                    if (http.status === 0) {
                        failureWrapperCB( new Error("Request failed"), null, url, http, job_id );
                    } else {
                        failureWrapperCB( new Error("Request failed with HTTP " + http.status + " (" + http.statusText + ")"), null, url,
                                         http, job_id );
                    }
                }
            }
        }
    };  // end getJobCallback
    var sendInitialRequest = function( get_job ) {
        var create_job_request = {
            endpoint: endpoint,
            request_encoding: "json",
            data: "",
            data_str: requestString,
            options: {}
        };
        var create_job_request_string = JSON.stringify( create_job_request );


        var http = new XMLHttpRequest();
        var url = urls.getCurrentItem();
        http.open("POST", url + "/create/job", true);

        _create_headers( http, authorization, custom_headers );

        var timedOut = false;

        http.onloadend = function() {
            parsePreviousCallResponse(http, timedOut);
        };

        http.ontimeout = function() {
            timedOut = true;
            failureWrapperCB(new Error("Request timed out"), null, url);
        };

        http.timeout = timeout;
        http.send( create_job_request_string );
    };  // end sendInitialRequest
    sendInitialRequest();
};  // end submit_job_request_async
GPUdb.prototype.submit_request_async = function(endpoint, requestString, callback) {
    var initialURL = this.urls.getCurrentItem();

    var urls = this.urls;
    var authorization = this.authorization;
    var timeout = this.timeout;
    var failureCount = 0;
    var custom_headers  = this._custom_http_headers;
    var _create_headers = this._create_headers;
    var failureWrapperCB = function(err, data, url) {
        failureCount += 1;
        if (failureCount < urls.getSize()) {
            // has already advanced the list. Retry using the new head.
            if ((url !== urls.getCurrentItem()) ||
                (urls.getNextItem() !== initialURL)) {
                sendRequest();
            }
        }
        else {
            callback(err, data);
        }
    };

    var sendRequest = function() {
        var http = new XMLHttpRequest();
        var url = urls.getCurrentItem();
        http.open("POST", url + endpoint, true);
        _create_headers( http, authorization, custom_headers );

        var timedOut = false;

        http.onloadend = function() {
            if (!timedOut) {
                if (http.status === 200 || http.status === 400) {
                    try {
                        var response = JSON.parse(http.responseText);
                    } catch (e) {
                        callback(new Error("Unable to parse response: " + e), null);
                        return;
                    }

                    if (response.status === "OK") {
                        try {
                            var data = JSON.parse( response.data_str );
                        } catch (e) {
                            callback(new Error("Unable to parse response: " + e), null);
                            return;
                        }

                        callback(null, data);
                    } else {
                        callback(new Error(response.message), null);
                    }
                } else {
                    if (http.status === 0) {
                        failureWrapperCB(new Error("Request failed"), null, url);
                    } else {
                        failureWrapperCB(new Error("Request failed with HTTP " + http.status + " (" + http.statusText + ")"), null, url);
                    }
                }
            }
        };

        http.ontimeout = function() {
            timedOut = true;
            failureWrapperCB(new Error("Request timed out"), null, url);
        }

        http.timeout = timeout;

        http.send(requestString);
    };

    sendRequest();
};
GPUdb.prototype.submit_request_sync = function(endpoint, requestString) {
    var initialURL = this.urls.getCurrentItem();
    var error = null;

    do {
        var http = new XMLHttpRequest();
        http.open("POST", this.urls.getCurrentItem() + endpoint, false);
        http = this._create_headers( http );

        try {
            http.send(requestString);
        }
        catch (e) {
            error = new Error("Failed to send request");
        }

        if (http.status === 200 || http.status === 400) {
            try {
                var response = JSON.parse(http.responseText);

                if (response.status === "OK") {
                    return JSON.parse( response.data_str );
                } else {
                    error = new Error(response.message);
                }
            } catch (e) {
                throw new Error("Unable to parse response: " + e);
            }

            throw error;
        } else {
            error = new Error("Request failed with HTTP " + http.status + " (" + http.statusText + ")");
        }
    }
    while (this.urls.getNextItem() !== initialURL);

    throw error;
};
GPUdb.RingList = function(items, initialIndex) {
    Object.defineProperty(this, "items", { enumerable: true, value: items });
    Object.defineProperty(this, "index", {
        enumerable: true,
        value: (initialIndex !== undefined && initialIndex !== null &&
                initialIndex >= 0 ? initialIndex : 0),
        writable: true
    });
}
GPUdb.RingList.prototype.getCurrentItem = function() {
    return this.items[this.index];
}
GPUdb.RingList.prototype.getNextItem = function() {
    this.index += 1;
    if (this.index >= this.items.length) {
        this.index = 0;
    }

    return this.items[this.index];
}
GPUdb.RingList.prototype.getSize = function() {
    return this.items.length;
}
/**
 * Creates a Type object containing metadata about a GPUdb type.
 *
 * @class
 * @classdesc Metadata about a GPUdb type.
 * @param {String} label A user-defined description string which can be used to
 *                 differentiate between data with otherwise identical schemas.
 * @param {...GPUdb.Type.Column} columns The list of columns that the type
 *                               comprises.
 */
GPUdb.Type = function(label, columns) {
    this.label = label;
    if (Array.isArray(columns)) {
        this.columns = columns;
    } else {
        this.columns = [];

        for (var i = 1; i < arguments.length; i++) {
            this.columns.push(arguments[i]);
        }
    }
};
GPUdb.Type.Column = function(name, type, properties) {
    this.name = name;
    this.type = type;
    if (properties !== undefined && properties !== null) {
        if (Array.isArray(properties)) {
            this.properties = properties;
        } else {
            this.properties = [];

            for (var i = 2; i < arguments.length; i++) {
                this.properties.push(arguments[i]);
            }
        }
    } else {
        this.properties = [];
    }
};
GPUdb.Type.Column.prototype.is_nullable = function() {
    return this.properties.indexOf("nullable") > -1;
};
GPUdb.Type.from_type_info = function(label, type_schema, properties) {
    if (typeof type_schema === "string" || type_schema instanceof String) {
        type_schema = JSON.parse(type_schema);
    }

    var columns = [];

    for (var i = 0; i < type_schema.fields.length; i++) {
        var field = type_schema.fields[i];
        var type = field.type;

        if (Array.isArray(type)) {
            for (var j = 0; j < type.length; j++) {
                if (type[j] !== "null") {
                    type = type[j];
                    break;
                }
            }
        }

        columns.push(new GPUdb.Type.Column(field.name, type, properties[field.name]));
    }

    return new GPUdb.Type(label, columns);
};
GPUdb.Type.prototype.generate_schema = function() {
    var schema = {
        type: "record",
        name: "type_name",
        fields: []
    };

    for (var i = 0; i < this.columns.length; i++) {
        var column = this.columns[i];

        schema.fields.push({
            name: column.name,
            type: column.is_nullable() ? [ column.type, "null" ] : column.type
        });
    }

    return schema;
};
Object.defineProperty(GPUdb, "api_version", { enumerable: true, value: "7.1.8.0" });
Object.defineProperty(GPUdb, "END_OF_SET", { value: -9999 });
GPUdb.decode = function(o) {
    if (Array.isArray(o)) {
        var result = [];

        for (var i = 0; i < o.length; i++) {
            result.push(GPUdb.decode(o[i]));
        }

        return result;
    } else {
        return JSON.parse(o);
    }
};
GPUdb.prototype.decode = function(o) {
    // to null
    if ( this.force_infinity_nan_conversion_to_null === true ) {
        return GPUdb.decode_no_inf_nan( o );
    }
    return GPUdb.decode_regular( o );
};
GPUdb.decode_regular = function(o) {
    if (Array.isArray(o)) {
        var result = [];

        for (var i = 0; i < o.length; i++) {
            result.push( GPUdb.decode_regular(o[i]) );
        }

        return result;
    } else {
        return JSON.parse(o);
    }
};
GPUdb.decode_no_inf_nan = function(o) {
    if (Array.isArray(o)) {
        var result = [];

        for (var i = 0; i < o.length; i++) {
            result.push( GPUdb.decode_no_inf_nan( o[i] ) );
        }

        return result;
    } else {
        return JSON.parse( o, function(k, v) {
            if (v === "Infinity") return null;
            else if (v === "-Infinity") return null;
            else if (v === "NaN") return null;
            else return v;
        } );
    }
};
GPUdb.encode = function(o) {
    if (Array.isArray(o)) {
        var result = [];

        for (var i = 0; i < o.length; i++) {
            result.push(GPUdb.encode(o[i]));
        }

        return result;
    } else {
        return JSON.stringify(o);
    }
};
GPUdb.Type.from_table = function(gpudb, table_name, callback) {
    var process_response = function(response, callback) {
        if (response.type_ids.length === 0) {
            callback(new Error("Table " + table_name + " does not exist."), null);
        }

        if (response.type_ids.length > 1) {
            var type_id = response.type_ids[0];

            for (var i = 1; i < response.type_ids.length; i++) {
                if (response.type_ids[i] !== type_id) {
                    callback(new Error("Table " + table_name + " is not homogeneous."), null);
                }
            }
        }

        callback(null, GPUdb.Type.from_type_info(response.type_labels[0], response.type_schemas[0], response.properties[0]));
    };

    if (callback !== undefined && callback !== null) {
        gpudb.show_table(table_name, {}, function(err, data) {
            if (err === null) {
                process_response(data, callback);
            } else {
                callback(err, null);
            }
        });
    } else {
        var response = gpudb.show_table(table_name, {});

        process_response(response, function(err, data) {
            if (err === null) {
                response = data;
            } else {
                throw err;
            }
        });

        return response;
    }
};
GPUdb.Type.from_type = function(gpudb, type_id, callback) {
    var process_response = function(response, callback) {
        if (response.type_ids.length === 0) {
            callback(Error("Type " + type_id + " does not exist."), null);
        }

        callback(null, GPUdb.Type.from_type_info(response.labels[0], response.type_schemas[0], response.properties[0]));
    };

    if (callback !== undefined && callback !== null) {
        gpudb.show_types(type_id, "", {}, function(err, data) {
            if (err === null) {
                process_response(data, callback);
            } else {
                callback(err, null);
            }
        });
    } else {
        var response = gpudb.show_types(type_id, "", {});

        process_response(response, function(err, data) {
            if (err === null) {
                response = data;
            } else {
                throw err;
            }
        });

        return response;
    }
};
GPUdb.Type.prototype.create = function(gpudb, callback) {
    var properties = {};

    for (var i = 0; i < this.columns.length; i++) {
        var column = this.columns[i];

        if (column.properties.length > 0) {
            properties[column.name] = column.properties;
        }
    }

    if (callback !== undefined && callback !== null) {
        gpudb.create_type(JSON.stringify(this.generate_schema()), this.label, properties, {}, function(err, data) {
            if (err === null) {
                callback(null, data.type_id);
            } else {
                callback(err, null);
            }
        });
    } else {
        return gpudb.create_type(JSON.stringify(this.generate_schema()), this.label, properties, {}).type_id;
    }
};
GPUdb.prototype.get_geo_json = function(table_name, offset, limit, options, callback) {
    var actual_request = {
        table_name: table_name,
        offset: (offset !== undefined && offset !== null) ? offset : 0,
        limit: (limit !== undefined && limit !== null) ? limit : 10000,
        encoding: "geojson",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/get/records", actual_request, function(err, data) {
            if (err === null) {
                var geo_json = GPUdb.decode(data.records_json)[0];
                callback(err, geo_json);
            }
            else {
                callback(err, data);
            }
        });
    } else {
        var data = this.submit_request("/get/records", actual_request);
        var geo_json = GPUdb.decode(data.records_json)[0];
        return geo_json;
    }
};
GPUdb.FileHandler = function (gpuDB) {
    if (!(gpuDB instanceof GPUdb))
        throw new Error("Invalid GPUdb reference specified");
    this.gpuDB = gpuDB;
    Object.defineProperty(this, "gpuDB", {
        enumerable: true,
        value: this.gpuDB
    });

    this.chunkSize = 60 * 1024 * 1024;
    Object.defineProperty(this, "chunkSize", {
        enumerable: true,
        value: this.chunkSize
    });


} // end FileHandler
GPUdb.FileHandler.prototype.upload = function (files, destination, options, progress_callback, callback) {

    if (callback === undefined || callback === null) {
        const self = this;

        return new Promise(function (resolve, reject) {
            self.upload(files, destination, options, progress_callback, function (err, response) {
                if (err !== null) {
                    reject(err);
                } else {
                    resolve(response);
                }
            });
        });
    }
    options = this.parse_options(options, "upload");

    let file_list = [];

    if (files !== null && files instanceof Object && Array.isArray(files)) {
        if (files.length > 0) {
            file_list = files;
        } else {
            throw new Error("'files' is an empty array - no files specified")
        }
    } else {
        file_list.push(files);
    }

    const process_response = function (file_name, data, callback) {
        if ((data.info !== undefined) && (data.info !== null)) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    };
    const dest_path = this.parse_dir_destination(destination);

    const toBase64 = (file) =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                const regex = /data:(.*);(.*),(.*)/gi;
                const match = regex.exec(reader.result);
                const data = match[3];
                return resolve(data);
            };
            reader.onerror = (error) => reject(reader.error);
        });

    for (let file of file_list) {
        if ((typeof (file) == "object") && (file !== null)
            && (file.name !== undefined) && (file.name !== null)) {

            const file_name = dest_path + file.name;

            if (file.size <= this.chunkSize) {
                toBase64(file).then(file_data => {
                    this.gpuDB.upload_files([file_name], [file_data], options, function (error, response) {
                        if (error === null) {
                            process_response(file_name, response, callback);
                        } else {
                            callback(error, null);
                        }
                    });
                }).catch(error => {
                    callback(error, null);
                });
            } else {
                this.upload_multipart(file, dest_path, this.chunkSize, {}, progress_callback, null)
                    .then((res) => {
                        process_response(file_name, res, callback);
                    })
                    .catch((error) => {
                        callback(error, null);
                    });
            }
        } else {
            const msg = "One of 'files' argument values was provided in "
                + "a bad format. Only Array of Files or Array of "
                + "string filepaths are allowed as 'files' value.";
            callback(new Error(msg), null);
        }
    }
};  // end upload



GPUdb.FileHandler.prototype.parse_flag_to_str = function (value, default_value) {
    if (value !== undefined && value !== null) {
        if ((typeof value) == "boolean") {
            return (value ? "true" : "false");
        } else if ((typeof value) == "string") {
            return value;
        } else {
            return default_value;
        }
    } else {
        return default_value;
    }
};

GPUdb.FileHandler.extract_filename = function (full_path, sep) {
    const filename_parts = full_path.split(sep);
    return filename_parts[filename_parts.length - 1];
};


GPUdb.FileHandler.prototype.parse_dir_destination = function (destination) {

    if (destination !== undefined && destination !== null
        && (typeof destination) == "string") {

        if (destination === "" || destination.length === 0) {
            throw new Error("KIFS destination path cannot be empty")
        }

        const last_slash_pos = destination.lastIndexOf("/");
        if (last_slash_pos !== destination.length - 1) {
            destination = destination + "/";
        }
        return destination;
    } else {
        throw new Error("KIFS destination either 'undefined' or 'null'")

    }
};


GPUdb.FileHandler.prototype.parse_options = function (incoming_options, endpoint) {
    const options = {};
    const default_file_encoding = 'base64';
    switch (endpoint) {
        case "upload":
            options.file_encoding = default_file_encoding;
            break;
        case "download":
            options.file_encoding = default_file_encoding;
            break;
    }
    return options;
};
GPUdb.FileHandler.prototype.upload_multipart = function (file, destination, chunk_size, options, progress_callback, callback) {
    const gpudb = this.gpuDB;
    const file_name = destination + file.name;
    const num_chunks = Math.floor(file.size / chunk_size) + 1;

    const create_uuid = function () {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11)
            .replace(
                /[018]/g,
                function (c) {
                    return (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16);
                }
            );
    }
    const start_multipart = function (gpudb, file_name) {
        const new_uuid = create_uuid();

        const options = {
            "multipart_upload_uuid": new_uuid,
            "multipart_operation": "init"
        };
        return new Promise(function (resolve, reject) {
            gpudb.upload_files([file_name], [], options, function (error, _response) {
                if (error) {
                    reject(error);
                } else {
                    resolve(new_uuid);
                }
            });

        });
    };
    const end_multipart = async function (gpudb, file_name, uuid) {
        const options = {
            "multipart_upload_uuid": uuid,
            "multipart_operation": "complete"
        };
        return new Promise(function (resolve, reject) {
            gpudb.upload_files([file_name], [], options, function (error, _response) {
                if (error) {
                    reject(error);
                } else {
                    resolve(uuid);
                }
            });

        });
    };
    const cancel_multipart = async function (gpudb, file_name, uuid) {
        const options = {
            "multipart_upload_uuid": uuid,
            "multipart_operation": "cancel"
        };
        return new Promise(function (resolve, reject) {
            gpudb.upload_files([file_name], [], options, function (error, _response) {
                if (error) {
                    reject(error);
                } else {
                    resolve(uuid);
                }
            });

        });
    };
    const upload_chunk_of_multipart = async function (gpudb, file_name, uuid, sequence, data) {

        const options = {
            "multipart_upload_uuid": uuid,
            "multipart_upload_part_number": sequence.toString(),
            "multipart_operation": "upload_part"
        };
        return new Promise(function (resolve, reject) {
            gpudb.upload_files([file_name], [data], options, function (error, _response) {
                if (error) {
                    reject(error);
                } else {
                    resolve({ "uuid": uuid, "sequence": sequence });
                }
            });
        })

    };
    const read_chunk = async function (file, offset, chunk_size, reader) {
        return new Promise(function (resolve, reject) {
            const blob = file.slice(offset, chunk_size + offset);
            reader.onload = function (_evt) {
                return resolve(reader.result);
            }
            reader.onerror = reject;
            reader.readAsBinaryString(blob);
        })
    }


    const errHandler = function (err) {
        console.error(err);
        throw err;
    };
    const uploadChunks = async function (uuid) {
        if (typeof (uuid) === "string" && uuid.length > 0) {

            const r = new FileReader();
            for (let idx = 1, offset = 0; offset <= file.size; idx++, offset += chunk_size) {
                try {
                    let chunk = await read_chunk(file, offset, chunk_size, r)
                    await upload_chunk_of_multipart(
                        gpudb,
                        file_name,
                        uuid,
                        idx,
                        chunk
                    );

                    if (progress_callback) {
                        progress_callback((idx / num_chunks) * 100);
                    }

                } catch (error) {
                    await cancel_multipart(
                        gpudb,
                        file_name,
                        uuid
                    );

                    errHandler(error)
                }

            }

            try {
                let end_resp = await end_multipart(gpudb, file_name, uuid);
                if (callback)
                    callback(end_resp)
                else
                    return end_resp
            } catch (error) {
                await cancel_multipart(
                    gpudb,
                    file_name,
                    uuid
                );
                errHandler(error)
            }


        } else {            
            await cancel_multipart(
                gpudb,
                file_name,
                uuid
            );
            
            throw Error("Could not upload file : " + file.name);
        }
    }

    return start_multipart(gpudb, file_name)
        .then(uploadChunks)
}
 GPUdb.FileHandler.prototype.download = function( filenames, options, callback ) {
    if (callback === undefined || callback === null) {
        var self = this;

        return new Promise(function(resolve, reject) {
            self.download(filenames, options, function(err, response) {
                if (err !== null) {
                    reject(err);
                } else {
                    resolve(response);
                }
            });
        });
    }
    options = this.parse_options(options, "download");

    let file_names;
    if (!(filenames instanceof Array) && (typeof(filenames) == "string")) {
        file_names = [filenames];
    } else if ( (filenames instanceof Array)
                && (filenames.length > 0)
                && (typeof(filenames[0]) == "string") ) {
        file_names = filenames;
    } else {
        throw new Error("One of the 'files' arguments is not a string filepath " +
                        "and is unsafe to process. Wrong input format is provided.");
    }
    var process_response = function(data, callback) {
        callback( null, data.file_data );
    }
    this.gpuDB.download_files(file_names, [], [], options, function(err, data) {
        if (err === null) {
            process_response(data, callback);
        } else {
            callback(err, null);
        }
    });

};  // end download
GPUdb.prototype.admin_add_host_request = function(request, callback) {
    var actual_request = {
        host_address: request.host_address,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/add/host", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/add/host", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_add_host = function(host_address, options, callback) {
    var actual_request = {
        host_address: host_address,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/add/host", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/add/host", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_add_ranks_request = function(request, callback) {
    var actual_request = {
        hosts: request.hosts,
        config_params: request.config_params,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/add/ranks", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/add/ranks", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_add_ranks = function(hosts, config_params, options, callback) {
    var actual_request = {
        hosts: hosts,
        config_params: config_params,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/add/ranks", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/add/ranks", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_alter_host_request = function(request, callback) {
    var actual_request = {
        host: request.host,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/alter/host", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/alter/host", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_alter_host = function(host, options, callback) {
    var actual_request = {
        host: host,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/alter/host", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/alter/host", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_alter_jobs_request = function(request, callback) {
    var actual_request = {
        job_ids: request.job_ids,
        action: request.action,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/alter/jobs", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/alter/jobs", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_alter_jobs = function(job_ids, action, options, callback) {
    var actual_request = {
        job_ids: job_ids,
        action: action,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/alter/jobs", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/alter/jobs", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_backup_begin_request = function(request, callback) {
    var actual_request = {
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/backup/begin", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/backup/begin", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_backup_begin = function(options, callback) {
    var actual_request = {
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/backup/begin", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/backup/begin", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_backup_end_request = function(request, callback) {
    var actual_request = {
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/backup/end", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/backup/end", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_backup_end = function(options, callback) {
    var actual_request = {
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/backup/end", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/backup/end", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_offline_request = function(request, callback) {
    var actual_request = {
        offline: request.offline,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/offline", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/offline", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_offline = function(offline, options, callback) {
    var actual_request = {
        offline: offline,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/offline", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/offline", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_rebalance_request = function(request, callback) {
    var actual_request = {
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/rebalance", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/rebalance", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_rebalance = function(options, callback) {
    var actual_request = {
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/rebalance", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/rebalance", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_remove_host_request = function(request, callback) {
    var actual_request = {
        host: request.host,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/remove/host", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/remove/host", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_remove_host = function(host, options, callback) {
    var actual_request = {
        host: host,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/remove/host", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/remove/host", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_remove_ranks_request = function(request, callback) {
    var actual_request = {
        ranks: request.ranks,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/remove/ranks", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/remove/ranks", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_remove_ranks = function(ranks, options, callback) {
    var actual_request = {
        ranks: ranks,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/remove/ranks", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/remove/ranks", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_show_alerts_request = function(request, callback) {
    var actual_request = {
        num_alerts: request.num_alerts,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/show/alerts", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/show/alerts", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_show_alerts = function(num_alerts, options, callback) {
    var actual_request = {
        num_alerts: num_alerts,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/show/alerts", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/show/alerts", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_show_cluster_operations_request = function(request, callback) {
    var actual_request = {
        history_index: (request.history_index !== undefined && request.history_index !== null) ? request.history_index : 0,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/show/cluster/operations", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/show/cluster/operations", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_show_cluster_operations = function(history_index, options, callback) {
    var actual_request = {
        history_index: (history_index !== undefined && history_index !== null) ? history_index : 0,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/show/cluster/operations", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/show/cluster/operations", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_show_jobs_request = function(request, callback) {
    var actual_request = {
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/show/jobs", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/show/jobs", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_show_jobs = function(options, callback) {
    var actual_request = {
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/show/jobs", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/show/jobs", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_show_shards_request = function(request, callback) {
    var actual_request = {
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/show/shards", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/show/shards", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_show_shards = function(options, callback) {
    var actual_request = {
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/show/shards", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/show/shards", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_shutdown_request = function(request, callback) {
    var actual_request = {
        exit_type: request.exit_type,
        authorization: request.authorization,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/shutdown", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/shutdown", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_shutdown = function(exit_type, authorization, options, callback) {
    var actual_request = {
        exit_type: exit_type,
        authorization: authorization,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/shutdown", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/shutdown", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_switchover_request = function(request, callback) {
    var actual_request = {
        processes: request.processes,
        destinations: request.destinations,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/switchover", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/switchover", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_switchover = function(processes, destinations, options, callback) {
    var actual_request = {
        processes: processes,
        destinations: destinations,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/switchover", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/switchover", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_verify_db_request = function(request, callback) {
    var actual_request = {
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/verifydb", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/verifydb", actual_request);
        return data;
    }
};
GPUdb.prototype.admin_verify_db = function(options, callback) {
    var actual_request = {
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/admin/verifydb", actual_request, callback);
    } else {
        var data = this.submit_request("/admin/verifydb", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_convex_hull_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        x_column_name: request.x_column_name,
        y_column_name: request.y_column_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/convexhull", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/convexhull", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_convex_hull = function(table_name, x_column_name, y_column_name, options, callback) {
    var actual_request = {
        table_name: table_name,
        x_column_name: x_column_name,
        y_column_name: y_column_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/convexhull", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/convexhull", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_group_by_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        column_names: request.column_names,
        offset: (request.offset !== undefined && request.offset !== null) ? request.offset : 0,
        limit: (request.limit !== undefined && request.limit !== null) ? request.limit : -9999,
        encoding: (request.encoding !== undefined && request.encoding !== null) ? request.encoding : "json",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/groupby", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.json_encoded_response);
                delete data.json_encoded_response;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/aggregate/groupby", actual_request);
        data.data = self.decode(data.json_encoded_response);
        delete data.json_encoded_response;
        return data;
    }
};
GPUdb.prototype.aggregate_group_by = function(table_name, column_names, offset, limit, options, callback) {
    var actual_request = {
        table_name: table_name,
        column_names: column_names,
        offset: (offset !== undefined && offset !== null) ? offset : 0,
        limit: (limit !== undefined && limit !== null) ? limit : -9999,
        encoding: "json",
        options: (options !== undefined && options !== null) ? options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/groupby", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.json_encoded_response);
                delete data.json_encoded_response;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/aggregate/groupby", actual_request);
        data.data = self.decode(data.json_encoded_response);
        delete data.json_encoded_response;
        return data;
    }
};
GPUdb.prototype.aggregate_histogram_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        column_name: request.column_name,
        start: request.start,
        end: request.end,
        interval: request.interval,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/histogram", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/histogram", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_histogram = function(table_name, column_name, start, end, interval, options, callback) {
    var actual_request = {
        table_name: table_name,
        column_name: column_name,
        start: start,
        end: end,
        interval: interval,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/histogram", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/histogram", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_k_means_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        column_names: request.column_names,
        k: request.k,
        tolerance: request.tolerance,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/kmeans", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/kmeans", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_k_means = function(table_name, column_names, k, tolerance, options, callback) {
    var actual_request = {
        table_name: table_name,
        column_names: column_names,
        k: k,
        tolerance: tolerance,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/kmeans", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/kmeans", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_min_max_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        column_name: request.column_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/minmax", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/minmax", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_min_max = function(table_name, column_name, options, callback) {
    var actual_request = {
        table_name: table_name,
        column_name: column_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/minmax", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/minmax", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_min_max_geometry_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        column_name: request.column_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/minmax/geometry", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/minmax/geometry", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_min_max_geometry = function(table_name, column_name, options, callback) {
    var actual_request = {
        table_name: table_name,
        column_name: column_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/minmax/geometry", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/minmax/geometry", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_statistics_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        column_name: request.column_name,
        stats: request.stats,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/statistics", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/statistics", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_statistics = function(table_name, column_name, stats, options, callback) {
    var actual_request = {
        table_name: table_name,
        column_name: column_name,
        stats: stats,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/statistics", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/statistics", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_statistics_by_range_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        select_expression: (request.select_expression !== undefined && request.select_expression !== null) ? request.select_expression : "",
        column_name: request.column_name,
        value_column_name: request.value_column_name,
        stats: request.stats,
        start: request.start,
        end: request.end,
        interval: request.interval,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/statistics/byrange", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/statistics/byrange", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_statistics_by_range = function(table_name, select_expression, column_name, value_column_name, stats, start, end, interval, options, callback) {
    var actual_request = {
        table_name: table_name,
        select_expression: (select_expression !== undefined && select_expression !== null) ? select_expression : "",
        column_name: column_name,
        value_column_name: value_column_name,
        stats: stats,
        start: start,
        end: end,
        interval: interval,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/statistics/byrange", actual_request, callback);
    } else {
        var data = this.submit_request("/aggregate/statistics/byrange", actual_request);
        return data;
    }
};
GPUdb.prototype.aggregate_unique_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        column_name: request.column_name,
        offset: (request.offset !== undefined && request.offset !== null) ? request.offset : 0,
        limit: (request.limit !== undefined && request.limit !== null) ? request.limit : -9999,
        encoding: (request.encoding !== undefined && request.encoding !== null) ? request.encoding : "json",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/unique", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.json_encoded_response);
                delete data.json_encoded_response;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/aggregate/unique", actual_request);
        data.data = self.decode(data.json_encoded_response);
        delete data.json_encoded_response;
        return data;
    }
};
GPUdb.prototype.aggregate_unique = function(table_name, column_name, offset, limit, options, callback) {
    var actual_request = {
        table_name: table_name,
        column_name: column_name,
        offset: (offset !== undefined && offset !== null) ? offset : 0,
        limit: (limit !== undefined && limit !== null) ? limit : -9999,
        encoding: "json",
        options: (options !== undefined && options !== null) ? options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/unique", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.json_encoded_response);
                delete data.json_encoded_response;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/aggregate/unique", actual_request);
        data.data = self.decode(data.json_encoded_response);
        delete data.json_encoded_response;
        return data;
    }
};
GPUdb.prototype.aggregate_unpivot_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        column_names: request.column_names,
        variable_column_name: (request.variable_column_name !== undefined && request.variable_column_name !== null) ? request.variable_column_name : "",
        value_column_name: (request.value_column_name !== undefined && request.value_column_name !== null) ? request.value_column_name : "",
        pivoted_columns: request.pivoted_columns,
        encoding: (request.encoding !== undefined && request.encoding !== null) ? request.encoding : "json",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/unpivot", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.json_encoded_response);
                delete data.json_encoded_response;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/aggregate/unpivot", actual_request);
        data.data = self.decode(data.json_encoded_response);
        delete data.json_encoded_response;
        return data;
    }
};
GPUdb.prototype.aggregate_unpivot = function(table_name, column_names, variable_column_name, value_column_name, pivoted_columns, options, callback) {
    var actual_request = {
        table_name: table_name,
        column_names: column_names,
        variable_column_name: (variable_column_name !== undefined && variable_column_name !== null) ? variable_column_name : "",
        value_column_name: (value_column_name !== undefined && value_column_name !== null) ? value_column_name : "",
        pivoted_columns: pivoted_columns,
        encoding: "json",
        options: (options !== undefined && options !== null) ? options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/aggregate/unpivot", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.json_encoded_response);
                delete data.json_encoded_response;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/aggregate/unpivot", actual_request);
        data.data = self.decode(data.json_encoded_response);
        delete data.json_encoded_response;
        return data;
    }
};
GPUdb.prototype.alter_credential_request = function(request, callback) {
    var actual_request = {
        credential_name: request.credential_name,
        credential_updates_map: request.credential_updates_map,
        options: request.options
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/credential", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/credential", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_credential = function(credential_name, credential_updates_map, options, callback) {
    var actual_request = {
        credential_name: credential_name,
        credential_updates_map: credential_updates_map,
        options: options
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/credential", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/credential", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_datasink_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        datasink_updates_map: request.datasink_updates_map,
        options: request.options
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/datasink", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/datasink", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_datasink = function(name, datasink_updates_map, options, callback) {
    var actual_request = {
        name: name,
        datasink_updates_map: datasink_updates_map,
        options: options
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/datasink", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/datasink", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_datasource_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        datasource_updates_map: request.datasource_updates_map,
        options: request.options
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/datasource", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/datasource", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_datasource = function(name, datasource_updates_map, options, callback) {
    var actual_request = {
        name: name,
        datasource_updates_map: datasource_updates_map,
        options: options
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/datasource", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/datasource", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_directory_request = function(request, callback) {
    var actual_request = {
        directory_name: request.directory_name,
        directory_updates_map: request.directory_updates_map,
        options: request.options
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/directory", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/directory", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_directory = function(directory_name, directory_updates_map, options, callback) {
    var actual_request = {
        directory_name: directory_name,
        directory_updates_map: directory_updates_map,
        options: options
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/directory", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/directory", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_graph_request = function(request, callback) {
    var actual_request = {
        graph_name: request.graph_name,
        action: request.action,
        action_arg: request.action_arg,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_graph = function(graph_name, action, action_arg, options, callback) {
    var actual_request = {
        graph_name: graph_name,
        action: action,
        action_arg: action_arg,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_model_request = function(request, callback) {
    var actual_request = {
        model_name: request.model_name,
        action: request.action,
        value: request.value,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/model", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/model", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_model = function(model_name, action, value, options, callback) {
    var actual_request = {
        model_name: model_name,
        action: action,
        value: value,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/model", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/model", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_resource_group_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        tier_attributes: (request.tier_attributes !== undefined && request.tier_attributes !== null) ? request.tier_attributes : {},
        ranking: (request.ranking !== undefined && request.ranking !== null) ? request.ranking : "",
        adjoining_resource_group: (request.adjoining_resource_group !== undefined && request.adjoining_resource_group !== null) ? request.adjoining_resource_group : "",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/resourcegroup", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/resourcegroup", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_resource_group = function(name, tier_attributes, ranking, adjoining_resource_group, options, callback) {
    var actual_request = {
        name: name,
        tier_attributes: (tier_attributes !== undefined && tier_attributes !== null) ? tier_attributes : {},
        ranking: (ranking !== undefined && ranking !== null) ? ranking : "",
        adjoining_resource_group: (adjoining_resource_group !== undefined && adjoining_resource_group !== null) ? adjoining_resource_group : "",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/resourcegroup", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/resourcegroup", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_role_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        action: request.action,
        value: request.value,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/role", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/role", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_role = function(name, action, value, options, callback) {
    var actual_request = {
        name: name,
        action: action,
        value: value,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/role", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/role", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_schema_request = function(request, callback) {
    var actual_request = {
        schema_name: request.schema_name,
        action: request.action,
        value: request.value,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/schema", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/schema", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_schema = function(schema_name, action, value, options, callback) {
    var actual_request = {
        schema_name: schema_name,
        action: action,
        value: value,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/schema", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/schema", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_system_properties_request = function(request, callback) {
    var actual_request = {
        property_updates_map: request.property_updates_map,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/system/properties", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/system/properties", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_system_properties = function(property_updates_map, options, callback) {
    var actual_request = {
        property_updates_map: property_updates_map,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/system/properties", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/system/properties", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_table_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        action: request.action,
        value: request.value,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/table", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/table", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_table = function(table_name, action, value, options, callback) {
    var actual_request = {
        table_name: table_name,
        action: action,
        value: value,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/table", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/table", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_table_columns_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        column_alterations: request.column_alterations,
        options: request.options
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/table/columns", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/table/columns", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_table_columns = function(table_name, column_alterations, options, callback) {
    var actual_request = {
        table_name: table_name,
        column_alterations: column_alterations,
        options: options
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/table/columns", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/table/columns", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_table_metadata_request = function(request, callback) {
    var actual_request = {
        table_names: request.table_names,
        metadata_map: request.metadata_map,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/table/metadata", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/table/metadata", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_table_metadata = function(table_names, metadata_map, options, callback) {
    var actual_request = {
        table_names: table_names,
        metadata_map: metadata_map,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/table/metadata", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/table/metadata", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_table_monitor_request = function(request, callback) {
    var actual_request = {
        topic_id: request.topic_id,
        monitor_updates_map: request.monitor_updates_map,
        options: request.options
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/tablemonitor", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/tablemonitor", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_table_monitor = function(topic_id, monitor_updates_map, options, callback) {
    var actual_request = {
        topic_id: topic_id,
        monitor_updates_map: monitor_updates_map,
        options: options
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/tablemonitor", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/tablemonitor", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_tier_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/tier", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/tier", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_tier = function(name, options, callback) {
    var actual_request = {
        name: name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/tier", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/tier", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_user_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        action: request.action,
        value: request.value,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/user", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/user", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_user = function(name, action, value, options, callback) {
    var actual_request = {
        name: name,
        action: action,
        value: value,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/user", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/user", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_video_request = function(request, callback) {
    var actual_request = {
        path: request.path,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/video", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/video", actual_request);
        return data;
    }
};
GPUdb.prototype.alter_video = function(path, options, callback) {
    var actual_request = {
        path: path,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/alter/video", actual_request, callback);
    } else {
        var data = this.submit_request("/alter/video", actual_request);
        return data;
    }
};
GPUdb.prototype.append_records_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        source_table_name: request.source_table_name,
        field_map: request.field_map,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/append/records", actual_request, callback);
    } else {
        var data = this.submit_request("/append/records", actual_request);
        return data;
    }
};
GPUdb.prototype.append_records = function(table_name, source_table_name, field_map, options, callback) {
    var actual_request = {
        table_name: table_name,
        source_table_name: source_table_name,
        field_map: field_map,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/append/records", actual_request, callback);
    } else {
        var data = this.submit_request("/append/records", actual_request);
        return data;
    }
};
GPUdb.prototype.clear_statistics_request = function(request, callback) {
    var actual_request = {
        table_name: (request.table_name !== undefined && request.table_name !== null) ? request.table_name : "",
        column_name: (request.column_name !== undefined && request.column_name !== null) ? request.column_name : "",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/clear/statistics", actual_request, callback);
    } else {
        var data = this.submit_request("/clear/statistics", actual_request);
        return data;
    }
};
GPUdb.prototype.clear_statistics = function(table_name, column_name, options, callback) {
    var actual_request = {
        table_name: (table_name !== undefined && table_name !== null) ? table_name : "",
        column_name: (column_name !== undefined && column_name !== null) ? column_name : "",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/clear/statistics", actual_request, callback);
    } else {
        var data = this.submit_request("/clear/statistics", actual_request);
        return data;
    }
};
GPUdb.prototype.clear_table_request = function(request, callback) {
    var actual_request = {
        table_name: (request.table_name !== undefined && request.table_name !== null) ? request.table_name : "",
        authorization: (request.authorization !== undefined && request.authorization !== null) ? request.authorization : "",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/clear/table", actual_request, callback);
    } else {
        var data = this.submit_request("/clear/table", actual_request);
        return data;
    }
};
GPUdb.prototype.clear_table = function(table_name, authorization, options, callback) {
    var actual_request = {
        table_name: (table_name !== undefined && table_name !== null) ? table_name : "",
        authorization: (authorization !== undefined && authorization !== null) ? authorization : "",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/clear/table", actual_request, callback);
    } else {
        var data = this.submit_request("/clear/table", actual_request);
        return data;
    }
};
GPUdb.prototype.clear_table_monitor_request = function(request, callback) {
    var actual_request = {
        topic_id: request.topic_id,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/clear/tablemonitor", actual_request, callback);
    } else {
        var data = this.submit_request("/clear/tablemonitor", actual_request);
        return data;
    }
};
GPUdb.prototype.clear_table_monitor = function(topic_id, options, callback) {
    var actual_request = {
        topic_id: topic_id,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/clear/tablemonitor", actual_request, callback);
    } else {
        var data = this.submit_request("/clear/tablemonitor", actual_request);
        return data;
    }
};
GPUdb.prototype.clear_trigger_request = function(request, callback) {
    var actual_request = {
        trigger_id: request.trigger_id,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/clear/trigger", actual_request, callback);
    } else {
        var data = this.submit_request("/clear/trigger", actual_request);
        return data;
    }
};
GPUdb.prototype.clear_trigger = function(trigger_id, options, callback) {
    var actual_request = {
        trigger_id: trigger_id,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/clear/trigger", actual_request, callback);
    } else {
        var data = this.submit_request("/clear/trigger", actual_request);
        return data;
    }
};
GPUdb.prototype.collect_statistics_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        column_names: request.column_names,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/collect/statistics", actual_request, callback);
    } else {
        var data = this.submit_request("/collect/statistics", actual_request);
        return data;
    }
};
GPUdb.prototype.collect_statistics = function(table_name, column_names, options, callback) {
    var actual_request = {
        table_name: table_name,
        column_names: column_names,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/collect/statistics", actual_request, callback);
    } else {
        var data = this.submit_request("/collect/statistics", actual_request);
        return data;
    }
};
GPUdb.prototype.create_container_registry_request = function(request, callback) {
    var actual_request = {
        registry_name: request.registry_name,
        uri: request.uri,
        credential: request.credential,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/container/registry", actual_request, callback);
    } else {
        var data = this.submit_request("/create/container/registry", actual_request);
        return data;
    }
};
GPUdb.prototype.create_container_registry = function(registry_name, uri, credential, options, callback) {
    var actual_request = {
        registry_name: registry_name,
        uri: uri,
        credential: credential,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/container/registry", actual_request, callback);
    } else {
        var data = this.submit_request("/create/container/registry", actual_request);
        return data;
    }
};
GPUdb.prototype.create_credential_request = function(request, callback) {
    var actual_request = {
        credential_name: request.credential_name,
        type: request.type,
        identity: request.identity,
        secret: request.secret,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/credential", actual_request, callback);
    } else {
        var data = this.submit_request("/create/credential", actual_request);
        return data;
    }
};
GPUdb.prototype.create_credential = function(credential_name, type, identity, secret, options, callback) {
    var actual_request = {
        credential_name: credential_name,
        type: type,
        identity: identity,
        secret: secret,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/credential", actual_request, callback);
    } else {
        var data = this.submit_request("/create/credential", actual_request);
        return data;
    }
};
GPUdb.prototype.create_datasink_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        destination: request.destination,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/datasink", actual_request, callback);
    } else {
        var data = this.submit_request("/create/datasink", actual_request);
        return data;
    }
};
GPUdb.prototype.create_datasink = function(name, destination, options, callback) {
    var actual_request = {
        name: name,
        destination: destination,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/datasink", actual_request, callback);
    } else {
        var data = this.submit_request("/create/datasink", actual_request);
        return data;
    }
};
GPUdb.prototype.create_datasource_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        location: request.location,
        user_name: request.user_name,
        password: request.password,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/datasource", actual_request, callback);
    } else {
        var data = this.submit_request("/create/datasource", actual_request);
        return data;
    }
};
GPUdb.prototype.create_datasource = function(name, location, user_name, password, options, callback) {
    var actual_request = {
        name: name,
        location: location,
        user_name: user_name,
        password: password,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/datasource", actual_request, callback);
    } else {
        var data = this.submit_request("/create/datasource", actual_request);
        return data;
    }
};
GPUdb.prototype.create_delta_table_request = function(request, callback) {
    var actual_request = {
        delta_table_name: request.delta_table_name,
        table_name: request.table_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/deltatable", actual_request, callback);
    } else {
        var data = this.submit_request("/create/deltatable", actual_request);
        return data;
    }
};
GPUdb.prototype.create_delta_table = function(delta_table_name, table_name, options, callback) {
    var actual_request = {
        delta_table_name: delta_table_name,
        table_name: table_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/deltatable", actual_request, callback);
    } else {
        var data = this.submit_request("/create/deltatable", actual_request);
        return data;
    }
};
GPUdb.prototype.create_directory_request = function(request, callback) {
    var actual_request = {
        directory_name: request.directory_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/directory", actual_request, callback);
    } else {
        var data = this.submit_request("/create/directory", actual_request);
        return data;
    }
};
GPUdb.prototype.create_directory = function(directory_name, options, callback) {
    var actual_request = {
        directory_name: directory_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/directory", actual_request, callback);
    } else {
        var data = this.submit_request("/create/directory", actual_request);
        return data;
    }
};
GPUdb.prototype.create_graph_request = function(request, callback) {
    var actual_request = {
        graph_name: request.graph_name,
        directed_graph: (request.directed_graph !== undefined && request.directed_graph !== null) ? request.directed_graph : true,
        nodes: request.nodes,
        edges: request.edges,
        weights: request.weights,
        restrictions: request.restrictions,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/create/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.create_graph = function(graph_name, directed_graph, nodes, edges, weights, restrictions, options, callback) {
    var actual_request = {
        graph_name: graph_name,
        directed_graph: (directed_graph !== undefined && directed_graph !== null) ? directed_graph : true,
        nodes: nodes,
        edges: edges,
        weights: weights,
        restrictions: restrictions,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/create/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.create_job_request = function(request, callback) {
    var actual_request = {
        endpoint: request.endpoint,
        request_encoding: (request.request_encoding !== undefined && request.request_encoding !== null) ? request.request_encoding : "binary",
        data: request.data,
        data_str: request.data_str,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/job", actual_request, callback);
    } else {
        var data = this.submit_request("/create/job", actual_request);
        return data;
    }
};
GPUdb.prototype.create_job = function(endpoint, request_encoding, data, data_str, options, callback) {
    var actual_request = {
        endpoint: endpoint,
        request_encoding: (request_encoding !== undefined && request_encoding !== null) ? request_encoding : "binary",
        data: data,
        data_str: data_str,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/job", actual_request, callback);
    } else {
        var data = this.submit_request("/create/job", actual_request);
        return data;
    }
};
GPUdb.prototype.create_join_table_request = function(request, callback) {
    var actual_request = {
        join_table_name: request.join_table_name,
        table_names: request.table_names,
        column_names: request.column_names,
        expressions: (request.expressions !== undefined && request.expressions !== null) ? request.expressions : [],
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/jointable", actual_request, callback);
    } else {
        var data = this.submit_request("/create/jointable", actual_request);
        return data;
    }
};
GPUdb.prototype.create_join_table = function(join_table_name, table_names, column_names, expressions, options, callback) {
    var actual_request = {
        join_table_name: join_table_name,
        table_names: table_names,
        column_names: column_names,
        expressions: (expressions !== undefined && expressions !== null) ? expressions : [],
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/jointable", actual_request, callback);
    } else {
        var data = this.submit_request("/create/jointable", actual_request);
        return data;
    }
};
GPUdb.prototype.create_materialized_view_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/materializedview", actual_request, callback);
    } else {
        var data = this.submit_request("/create/materializedview", actual_request);
        return data;
    }
};
GPUdb.prototype.create_materialized_view = function(table_name, options, callback) {
    var actual_request = {
        table_name: table_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/materializedview", actual_request, callback);
    } else {
        var data = this.submit_request("/create/materializedview", actual_request);
        return data;
    }
};
GPUdb.prototype.create_proc_request = function(request, callback) {
    var actual_request = {
        proc_name: request.proc_name,
        execution_mode: (request.execution_mode !== undefined && request.execution_mode !== null) ? request.execution_mode : "distributed",
        files: (request.files !== undefined && request.files !== null) ? request.files : {},
        command: (request.command !== undefined && request.command !== null) ? request.command : "",
        args: (request.args !== undefined && request.args !== null) ? request.args : [],
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/create/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.create_proc = function(proc_name, execution_mode, files, command, args, options, callback) {
    var actual_request = {
        proc_name: proc_name,
        execution_mode: (execution_mode !== undefined && execution_mode !== null) ? execution_mode : "distributed",
        files: (files !== undefined && files !== null) ? files : {},
        command: (command !== undefined && command !== null) ? command : "",
        args: (args !== undefined && args !== null) ? args : [],
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/create/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.create_projection_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        projection_name: request.projection_name,
        column_names: request.column_names,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/projection", actual_request, callback);
    } else {
        var data = this.submit_request("/create/projection", actual_request);
        return data;
    }
};
GPUdb.prototype.create_projection = function(table_name, projection_name, column_names, options, callback) {
    var actual_request = {
        table_name: table_name,
        projection_name: projection_name,
        column_names: column_names,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/projection", actual_request, callback);
    } else {
        var data = this.submit_request("/create/projection", actual_request);
        return data;
    }
};
GPUdb.prototype.create_resource_group_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        tier_attributes: (request.tier_attributes !== undefined && request.tier_attributes !== null) ? request.tier_attributes : {},
        ranking: request.ranking,
        adjoining_resource_group: (request.adjoining_resource_group !== undefined && request.adjoining_resource_group !== null) ? request.adjoining_resource_group : "",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/resourcegroup", actual_request, callback);
    } else {
        var data = this.submit_request("/create/resourcegroup", actual_request);
        return data;
    }
};
GPUdb.prototype.create_resource_group = function(name, tier_attributes, ranking, adjoining_resource_group, options, callback) {
    var actual_request = {
        name: name,
        tier_attributes: (tier_attributes !== undefined && tier_attributes !== null) ? tier_attributes : {},
        ranking: ranking,
        adjoining_resource_group: (adjoining_resource_group !== undefined && adjoining_resource_group !== null) ? adjoining_resource_group : "",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/resourcegroup", actual_request, callback);
    } else {
        var data = this.submit_request("/create/resourcegroup", actual_request);
        return data;
    }
};
GPUdb.prototype.create_role_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/role", actual_request, callback);
    } else {
        var data = this.submit_request("/create/role", actual_request);
        return data;
    }
};
GPUdb.prototype.create_role = function(name, options, callback) {
    var actual_request = {
        name: name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/role", actual_request, callback);
    } else {
        var data = this.submit_request("/create/role", actual_request);
        return data;
    }
};
GPUdb.prototype.create_schema_request = function(request, callback) {
    var actual_request = {
        schema_name: request.schema_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/schema", actual_request, callback);
    } else {
        var data = this.submit_request("/create/schema", actual_request);
        return data;
    }
};
GPUdb.prototype.create_schema = function(schema_name, options, callback) {
    var actual_request = {
        schema_name: schema_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/schema", actual_request, callback);
    } else {
        var data = this.submit_request("/create/schema", actual_request);
        return data;
    }
};
GPUdb.prototype.create_state_table_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        input_table_name: request.input_table_name,
        init_table_name: request.init_table_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/statetable", actual_request, callback);
    } else {
        var data = this.submit_request("/create/statetable", actual_request);
        return data;
    }
};
GPUdb.prototype.create_state_table = function(table_name, input_table_name, init_table_name, options, callback) {
    var actual_request = {
        table_name: table_name,
        input_table_name: input_table_name,
        init_table_name: init_table_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/statetable", actual_request, callback);
    } else {
        var data = this.submit_request("/create/statetable", actual_request);
        return data;
    }
};
GPUdb.prototype.create_table_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        type_id: request.type_id,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/table", actual_request, callback);
    } else {
        var data = this.submit_request("/create/table", actual_request);
        return data;
    }
};
GPUdb.prototype.create_table = function(table_name, type_id, options, callback) {
    var actual_request = {
        table_name: table_name,
        type_id: type_id,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/table", actual_request, callback);
    } else {
        var data = this.submit_request("/create/table", actual_request);
        return data;
    }
};
GPUdb.prototype.create_table_external_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        filepaths: request.filepaths,
        modify_columns: (request.modify_columns !== undefined && request.modify_columns !== null) ? request.modify_columns : {},
        create_table_options: (request.create_table_options !== undefined && request.create_table_options !== null) ? request.create_table_options : {},
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/table/external", actual_request, callback);
    } else {
        var data = this.submit_request("/create/table/external", actual_request);
        return data;
    }
};
GPUdb.prototype.create_table_external = function(table_name, filepaths, modify_columns, create_table_options, options, callback) {
    var actual_request = {
        table_name: table_name,
        filepaths: filepaths,
        modify_columns: (modify_columns !== undefined && modify_columns !== null) ? modify_columns : {},
        create_table_options: (create_table_options !== undefined && create_table_options !== null) ? create_table_options : {},
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/table/external", actual_request, callback);
    } else {
        var data = this.submit_request("/create/table/external", actual_request);
        return data;
    }
};
GPUdb.prototype.create_table_monitor_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/tablemonitor", actual_request, callback);
    } else {
        var data = this.submit_request("/create/tablemonitor", actual_request);
        return data;
    }
};
GPUdb.prototype.create_table_monitor = function(table_name, options, callback) {
    var actual_request = {
        table_name: table_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/tablemonitor", actual_request, callback);
    } else {
        var data = this.submit_request("/create/tablemonitor", actual_request);
        return data;
    }
};
GPUdb.prototype.create_trigger_by_area_request = function(request, callback) {
    var actual_request = {
        request_id: request.request_id,
        table_names: request.table_names,
        x_column_name: request.x_column_name,
        x_vector: request.x_vector,
        y_column_name: request.y_column_name,
        y_vector: request.y_vector,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/trigger/byarea", actual_request, callback);
    } else {
        var data = this.submit_request("/create/trigger/byarea", actual_request);
        return data;
    }
};
GPUdb.prototype.create_trigger_by_area = function(request_id, table_names, x_column_name, x_vector, y_column_name, y_vector, options, callback) {
    var actual_request = {
        request_id: request_id,
        table_names: table_names,
        x_column_name: x_column_name,
        x_vector: x_vector,
        y_column_name: y_column_name,
        y_vector: y_vector,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/trigger/byarea", actual_request, callback);
    } else {
        var data = this.submit_request("/create/trigger/byarea", actual_request);
        return data;
    }
};
GPUdb.prototype.create_trigger_by_range_request = function(request, callback) {
    var actual_request = {
        request_id: request.request_id,
        table_names: request.table_names,
        column_name: request.column_name,
        min: request.min,
        max: request.max,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/trigger/byrange", actual_request, callback);
    } else {
        var data = this.submit_request("/create/trigger/byrange", actual_request);
        return data;
    }
};
GPUdb.prototype.create_trigger_by_range = function(request_id, table_names, column_name, min, max, options, callback) {
    var actual_request = {
        request_id: request_id,
        table_names: table_names,
        column_name: column_name,
        min: min,
        max: max,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/trigger/byrange", actual_request, callback);
    } else {
        var data = this.submit_request("/create/trigger/byrange", actual_request);
        return data;
    }
};
GPUdb.prototype.create_type_request = function(request, callback) {
    var actual_request = {
        type_definition: request.type_definition,
        label: request.label,
        properties: (request.properties !== undefined && request.properties !== null) ? request.properties : {},
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/type", actual_request, callback);
    } else {
        var data = this.submit_request("/create/type", actual_request);
        return data;
    }
};
GPUdb.prototype.create_type = function(type_definition, label, properties, options, callback) {
    var actual_request = {
        type_definition: type_definition,
        label: label,
        properties: (properties !== undefined && properties !== null) ? properties : {},
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/type", actual_request, callback);
    } else {
        var data = this.submit_request("/create/type", actual_request);
        return data;
    }
};
GPUdb.prototype.create_union_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        table_names: request.table_names,
        input_column_names: request.input_column_names,
        output_column_names: request.output_column_names,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/union", actual_request, callback);
    } else {
        var data = this.submit_request("/create/union", actual_request);
        return data;
    }
};
GPUdb.prototype.create_union = function(table_name, table_names, input_column_names, output_column_names, options, callback) {
    var actual_request = {
        table_name: table_name,
        table_names: table_names,
        input_column_names: input_column_names,
        output_column_names: output_column_names,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/union", actual_request, callback);
    } else {
        var data = this.submit_request("/create/union", actual_request);
        return data;
    }
};
GPUdb.prototype.create_user_external_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/user/external", actual_request, callback);
    } else {
        var data = this.submit_request("/create/user/external", actual_request);
        return data;
    }
};
GPUdb.prototype.create_user_external = function(name, options, callback) {
    var actual_request = {
        name: name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/user/external", actual_request, callback);
    } else {
        var data = this.submit_request("/create/user/external", actual_request);
        return data;
    }
};
GPUdb.prototype.create_user_internal_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        password: request.password,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/user/internal", actual_request, callback);
    } else {
        var data = this.submit_request("/create/user/internal", actual_request);
        return data;
    }
};
GPUdb.prototype.create_user_internal = function(name, password, options, callback) {
    var actual_request = {
        name: name,
        password: password,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/user/internal", actual_request, callback);
    } else {
        var data = this.submit_request("/create/user/internal", actual_request);
        return data;
    }
};
GPUdb.prototype.create_video_request = function(request, callback) {
    var actual_request = {
        attribute: request.attribute,
        begin: request.begin,
        duration_seconds: request.duration_seconds,
        end: request.end,
        frames_per_second: request.frames_per_second,
        style: request.style,
        path: request.path,
        style_parameters: request.style_parameters,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/video", actual_request, callback);
    } else {
        var data = this.submit_request("/create/video", actual_request);
        return data;
    }
};
GPUdb.prototype.create_video = function(attribute, begin, duration_seconds, end, frames_per_second, style, path, style_parameters, options, callback) {
    var actual_request = {
        attribute: attribute,
        begin: begin,
        duration_seconds: duration_seconds,
        end: end,
        frames_per_second: frames_per_second,
        style: style,
        path: path,
        style_parameters: style_parameters,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/create/video", actual_request, callback);
    } else {
        var data = this.submit_request("/create/video", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_directory_request = function(request, callback) {
    var actual_request = {
        directory_name: request.directory_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/directory", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/directory", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_directory = function(directory_name, options, callback) {
    var actual_request = {
        directory_name: directory_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/directory", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/directory", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_files_request = function(request, callback) {
    var actual_request = {
        file_names: request.file_names,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/files", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/files", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_files = function(file_names, options, callback) {
    var actual_request = {
        file_names: file_names,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/files", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/files", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_graph_request = function(request, callback) {
    var actual_request = {
        graph_name: request.graph_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_graph = function(graph_name, options, callback) {
    var actual_request = {
        graph_name: graph_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_proc_request = function(request, callback) {
    var actual_request = {
        proc_name: request.proc_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_proc = function(proc_name, options, callback) {
    var actual_request = {
        proc_name: proc_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_records_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        expressions: request.expressions,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/records", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/records", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_records = function(table_name, expressions, options, callback) {
    var actual_request = {
        table_name: table_name,
        expressions: expressions,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/records", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/records", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_resource_group_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/resourcegroup", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/resourcegroup", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_resource_group = function(name, options, callback) {
    var actual_request = {
        name: name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/resourcegroup", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/resourcegroup", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_role_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/role", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/role", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_role = function(name, options, callback) {
    var actual_request = {
        name: name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/role", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/role", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_user_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/user", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/user", actual_request);
        return data;
    }
};
GPUdb.prototype.delete_user = function(name, options, callback) {
    var actual_request = {
        name: name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/delete/user", actual_request, callback);
    } else {
        var data = this.submit_request("/delete/user", actual_request);
        return data;
    }
};
GPUdb.prototype.download_files_request = function(request, callback) {
    var actual_request = {
        file_names: request.file_names,
        read_offsets: request.read_offsets,
        read_lengths: request.read_lengths,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/download/files", actual_request, callback);
    } else {
        var data = this.submit_request("/download/files", actual_request);
        return data;
    }
};
GPUdb.prototype.download_files = function(file_names, read_offsets, read_lengths, options, callback) {
    var actual_request = {
        file_names: file_names,
        read_offsets: read_offsets,
        read_lengths: read_lengths,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/download/files", actual_request, callback);
    } else {
        var data = this.submit_request("/download/files", actual_request);
        return data;
    }
};
GPUdb.prototype.drop_container_registry_request = function(request, callback) {
    var actual_request = {
        registry_name: request.registry_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/drop/container/registry", actual_request, callback);
    } else {
        var data = this.submit_request("/drop/container/registry", actual_request);
        return data;
    }
};
GPUdb.prototype.drop_container_registry = function(registry_name, options, callback) {
    var actual_request = {
        registry_name: registry_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/drop/container/registry", actual_request, callback);
    } else {
        var data = this.submit_request("/drop/container/registry", actual_request);
        return data;
    }
};
GPUdb.prototype.drop_credential_request = function(request, callback) {
    var actual_request = {
        credential_name: request.credential_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/drop/credential", actual_request, callback);
    } else {
        var data = this.submit_request("/drop/credential", actual_request);
        return data;
    }
};
GPUdb.prototype.drop_credential = function(credential_name, options, callback) {
    var actual_request = {
        credential_name: credential_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/drop/credential", actual_request, callback);
    } else {
        var data = this.submit_request("/drop/credential", actual_request);
        return data;
    }
};
GPUdb.prototype.drop_datasink_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/drop/datasink", actual_request, callback);
    } else {
        var data = this.submit_request("/drop/datasink", actual_request);
        return data;
    }
};
GPUdb.prototype.drop_datasink = function(name, options, callback) {
    var actual_request = {
        name: name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/drop/datasink", actual_request, callback);
    } else {
        var data = this.submit_request("/drop/datasink", actual_request);
        return data;
    }
};
GPUdb.prototype.drop_datasource_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/drop/datasource", actual_request, callback);
    } else {
        var data = this.submit_request("/drop/datasource", actual_request);
        return data;
    }
};
GPUdb.prototype.drop_datasource = function(name, options, callback) {
    var actual_request = {
        name: name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/drop/datasource", actual_request, callback);
    } else {
        var data = this.submit_request("/drop/datasource", actual_request);
        return data;
    }
};
GPUdb.prototype.drop_model_request = function(request, callback) {
    var actual_request = {
        model_name: request.model_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/drop/model", actual_request, callback);
    } else {
        var data = this.submit_request("/drop/model", actual_request);
        return data;
    }
};
GPUdb.prototype.drop_model = function(model_name, options, callback) {
    var actual_request = {
        model_name: model_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/drop/model", actual_request, callback);
    } else {
        var data = this.submit_request("/drop/model", actual_request);
        return data;
    }
};
GPUdb.prototype.drop_schema_request = function(request, callback) {
    var actual_request = {
        schema_name: request.schema_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/drop/schema", actual_request, callback);
    } else {
        var data = this.submit_request("/drop/schema", actual_request);
        return data;
    }
};
GPUdb.prototype.drop_schema = function(schema_name, options, callback) {
    var actual_request = {
        schema_name: schema_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/drop/schema", actual_request, callback);
    } else {
        var data = this.submit_request("/drop/schema", actual_request);
        return data;
    }
};
GPUdb.prototype.evaluate_model_request = function(request, callback) {
    var actual_request = {
        model_name: request.model_name,
        replicas: request.replicas,
        deployment_mode: request.deployment_mode,
        source_table: request.source_table,
        destination_table: request.destination_table,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/evaluate/model", actual_request, callback);
    } else {
        var data = this.submit_request("/evaluate/model", actual_request);
        return data;
    }
};
GPUdb.prototype.evaluate_model = function(model_name, replicas, deployment_mode, source_table, destination_table, options, callback) {
    var actual_request = {
        model_name: model_name,
        replicas: replicas,
        deployment_mode: deployment_mode,
        source_table: source_table,
        destination_table: destination_table,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/evaluate/model", actual_request, callback);
    } else {
        var data = this.submit_request("/evaluate/model", actual_request);
        return data;
    }
};
GPUdb.prototype.execute_proc_request = function(request, callback) {
    var actual_request = {
        proc_name: request.proc_name,
        params: (request.params !== undefined && request.params !== null) ? request.params : {},
        bin_params: (request.bin_params !== undefined && request.bin_params !== null) ? request.bin_params : {},
        input_table_names: (request.input_table_names !== undefined && request.input_table_names !== null) ? request.input_table_names : [],
        input_column_names: (request.input_column_names !== undefined && request.input_column_names !== null) ? request.input_column_names : {},
        output_table_names: (request.output_table_names !== undefined && request.output_table_names !== null) ? request.output_table_names : [],
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/execute/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/execute/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.execute_proc = function(proc_name, params, bin_params, input_table_names, input_column_names, output_table_names, options, callback) {
    var actual_request = {
        proc_name: proc_name,
        params: (params !== undefined && params !== null) ? params : {},
        bin_params: (bin_params !== undefined && bin_params !== null) ? bin_params : {},
        input_table_names: (input_table_names !== undefined && input_table_names !== null) ? input_table_names : [],
        input_column_names: (input_column_names !== undefined && input_column_names !== null) ? input_column_names : {},
        output_table_names: (output_table_names !== undefined && output_table_names !== null) ? output_table_names : [],
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/execute/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/execute/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.execute_sql_request = function(request, callback) {
    var actual_request = {
        statement: request.statement,
        offset: (request.offset !== undefined && request.offset !== null) ? request.offset : 0,
        limit: (request.limit !== undefined && request.limit !== null) ? request.limit : -9999,
        encoding: (request.encoding !== undefined && request.encoding !== null) ? request.encoding : "json",
        request_schema_str: (request.request_schema_str !== undefined && request.request_schema_str !== null) ? request.request_schema_str : "",
        data: (request.data !== undefined && request.data !== null) ? request.data : [],
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/execute/sql", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.json_encoded_response);
                delete data.json_encoded_response;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/execute/sql", actual_request);
        data.data = self.decode(data.json_encoded_response);
        delete data.json_encoded_response;
        return data;
    }
};
GPUdb.prototype.execute_sql = function(statement, offset, limit, request_schema_str, data, options, callback) {
    var actual_request = {
        statement: statement,
        offset: (offset !== undefined && offset !== null) ? offset : 0,
        limit: (limit !== undefined && limit !== null) ? limit : -9999,
        encoding: "json",
        request_schema_str: (request_schema_str !== undefined && request_schema_str !== null) ? request_schema_str : "",
        data: (data !== undefined && data !== null) ? data : [],
        options: (options !== undefined && options !== null) ? options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/execute/sql", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.json_encoded_response);
                delete data.json_encoded_response;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/execute/sql", actual_request);
        data.data = self.decode(data.json_encoded_response);
        delete data.json_encoded_response;
        return data;
    }
};
GPUdb.prototype.export_records_to_files_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        filepath: request.filepath,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/export/records/tofiles", actual_request, callback);
    } else {
        var data = this.submit_request("/export/records/tofiles", actual_request);
        return data;
    }
};
GPUdb.prototype.export_records_to_files = function(table_name, filepath, options, callback) {
    var actual_request = {
        table_name: table_name,
        filepath: filepath,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/export/records/tofiles", actual_request, callback);
    } else {
        var data = this.submit_request("/export/records/tofiles", actual_request);
        return data;
    }
};
GPUdb.prototype.export_records_to_table_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        remote_query: request.remote_query,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/export/records/totable", actual_request, callback);
    } else {
        var data = this.submit_request("/export/records/totable", actual_request);
        return data;
    }
};
GPUdb.prototype.export_records_to_table = function(table_name, remote_query, options, callback) {
    var actual_request = {
        table_name: table_name,
        remote_query: remote_query,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/export/records/totable", actual_request, callback);
    } else {
        var data = this.submit_request("/export/records/totable", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        expression: request.expression,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter", actual_request, callback);
    } else {
        var data = this.submit_request("/filter", actual_request);
        return data;
    }
};
GPUdb.prototype.filter = function(table_name, view_name, expression, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        expression: expression,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter", actual_request, callback);
    } else {
        var data = this.submit_request("/filter", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_area_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        x_column_name: request.x_column_name,
        x_vector: request.x_vector,
        y_column_name: request.y_column_name,
        y_vector: request.y_vector,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byarea", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byarea", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_area = function(table_name, view_name, x_column_name, x_vector, y_column_name, y_vector, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        x_column_name: x_column_name,
        x_vector: x_vector,
        y_column_name: y_column_name,
        y_vector: y_vector,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byarea", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byarea", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_area_geometry_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        column_name: request.column_name,
        x_vector: request.x_vector,
        y_vector: request.y_vector,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byarea/geometry", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byarea/geometry", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_area_geometry = function(table_name, view_name, column_name, x_vector, y_vector, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        column_name: column_name,
        x_vector: x_vector,
        y_vector: y_vector,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byarea/geometry", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byarea/geometry", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_box_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        x_column_name: request.x_column_name,
        min_x: request.min_x,
        max_x: request.max_x,
        y_column_name: request.y_column_name,
        min_y: request.min_y,
        max_y: request.max_y,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/bybox", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/bybox", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_box = function(table_name, view_name, x_column_name, min_x, max_x, y_column_name, min_y, max_y, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        x_column_name: x_column_name,
        min_x: min_x,
        max_x: max_x,
        y_column_name: y_column_name,
        min_y: min_y,
        max_y: max_y,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/bybox", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/bybox", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_box_geometry_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        column_name: request.column_name,
        min_x: request.min_x,
        max_x: request.max_x,
        min_y: request.min_y,
        max_y: request.max_y,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/bybox/geometry", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/bybox/geometry", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_box_geometry = function(table_name, view_name, column_name, min_x, max_x, min_y, max_y, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        column_name: column_name,
        min_x: min_x,
        max_x: max_x,
        min_y: min_y,
        max_y: max_y,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/bybox/geometry", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/bybox/geometry", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_geometry_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        column_name: request.column_name,
        input_wkt: (request.input_wkt !== undefined && request.input_wkt !== null) ? request.input_wkt : "",
        operation: request.operation,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/bygeometry", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/bygeometry", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_geometry = function(table_name, view_name, column_name, input_wkt, operation, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        column_name: column_name,
        input_wkt: (input_wkt !== undefined && input_wkt !== null) ? input_wkt : "",
        operation: operation,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/bygeometry", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/bygeometry", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_list_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        column_values_map: request.column_values_map,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/bylist", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/bylist", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_list = function(table_name, view_name, column_values_map, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        column_values_map: column_values_map,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/bylist", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/bylist", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_radius_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        x_column_name: request.x_column_name,
        x_center: request.x_center,
        y_column_name: request.y_column_name,
        y_center: request.y_center,
        radius: request.radius,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byradius", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byradius", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_radius = function(table_name, view_name, x_column_name, x_center, y_column_name, y_center, radius, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        x_column_name: x_column_name,
        x_center: x_center,
        y_column_name: y_column_name,
        y_center: y_center,
        radius: radius,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byradius", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byradius", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_radius_geometry_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        column_name: request.column_name,
        x_center: request.x_center,
        y_center: request.y_center,
        radius: request.radius,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byradius/geometry", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byradius/geometry", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_radius_geometry = function(table_name, view_name, column_name, x_center, y_center, radius, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        column_name: column_name,
        x_center: x_center,
        y_center: y_center,
        radius: radius,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byradius/geometry", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byradius/geometry", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_range_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        column_name: request.column_name,
        lower_bound: request.lower_bound,
        upper_bound: request.upper_bound,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byrange", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byrange", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_range = function(table_name, view_name, column_name, lower_bound, upper_bound, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        column_name: column_name,
        lower_bound: lower_bound,
        upper_bound: upper_bound,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byrange", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byrange", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_series_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        track_id: request.track_id,
        target_track_ids: request.target_track_ids,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byseries", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byseries", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_series = function(table_name, view_name, track_id, target_track_ids, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        track_id: track_id,
        target_track_ids: target_track_ids,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byseries", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byseries", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_string_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        expression: request.expression,
        mode: request.mode,
        column_names: request.column_names,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/bystring", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/bystring", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_string = function(table_name, view_name, expression, mode, column_names, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        expression: expression,
        mode: mode,
        column_names: column_names,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/bystring", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/bystring", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_table_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        column_name: request.column_name,
        source_table_name: request.source_table_name,
        source_table_column_name: request.source_table_column_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/bytable", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/bytable", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_table = function(table_name, view_name, column_name, source_table_name, source_table_column_name, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        column_name: column_name,
        source_table_name: source_table_name,
        source_table_column_name: source_table_column_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/bytable", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/bytable", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_value_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        is_string: request.is_string,
        value: (request.value !== undefined && request.value !== null) ? request.value : 0,
        value_str: (request.value_str !== undefined && request.value_str !== null) ? request.value_str : "",
        column_name: request.column_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byvalue", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byvalue", actual_request);
        return data;
    }
};
GPUdb.prototype.filter_by_value = function(table_name, view_name, is_string, value, value_str, column_name, options, callback) {
    var actual_request = {
        table_name: table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        is_string: is_string,
        value: (value !== undefined && value !== null) ? value : 0,
        value_str: (value_str !== undefined && value_str !== null) ? value_str : "",
        column_name: column_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/filter/byvalue", actual_request, callback);
    } else {
        var data = this.submit_request("/filter/byvalue", actual_request);
        return data;
    }
};
GPUdb.prototype.get_job_request = function(request, callback) {
    var actual_request = {
        job_id: request.job_id,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/get/job", actual_request, callback);
    } else {
        var data = this.submit_request("/get/job", actual_request);
        return data;
    }
};
GPUdb.prototype.get_job = function(job_id, options, callback) {
    var actual_request = {
        job_id: job_id,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/get/job", actual_request, callback);
    } else {
        var data = this.submit_request("/get/job", actual_request);
        return data;
    }
};
GPUdb.prototype.get_records_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        offset: (request.offset !== undefined && request.offset !== null) ? request.offset : 0,
        limit: (request.limit !== undefined && request.limit !== null) ? request.limit : -9999,
        encoding: (request.encoding !== undefined && request.encoding !== null) ? request.encoding : "json",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/get/records", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.records_json);
                delete data.records_json;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/get/records", actual_request);
        data.data = self.decode(data.records_json);
        delete data.records_json;
        return data;
    }
};
GPUdb.prototype.get_records = function(table_name, offset, limit, options, callback) {
    var actual_request = {
        table_name: table_name,
        offset: (offset !== undefined && offset !== null) ? offset : 0,
        limit: (limit !== undefined && limit !== null) ? limit : -9999,
        encoding: "json",
        options: (options !== undefined && options !== null) ? options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/get/records", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.records_json);
                delete data.records_json;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/get/records", actual_request);
        data.data = self.decode(data.records_json);
        delete data.records_json;
        return data;
    }
};
GPUdb.prototype.get_records_by_column_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        column_names: request.column_names,
        offset: (request.offset !== undefined && request.offset !== null) ? request.offset : 0,
        limit: (request.limit !== undefined && request.limit !== null) ? request.limit : -9999,
        encoding: (request.encoding !== undefined && request.encoding !== null) ? request.encoding : "json",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/get/records/bycolumn", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.json_encoded_response);
                delete data.json_encoded_response;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/get/records/bycolumn", actual_request);
        data.data = self.decode(data.json_encoded_response);
        delete data.json_encoded_response;
        return data;
    }
};
GPUdb.prototype.get_records_by_column = function(table_name, column_names, offset, limit, options, callback) {
    var actual_request = {
        table_name: table_name,
        column_names: column_names,
        offset: (offset !== undefined && offset !== null) ? offset : 0,
        limit: (limit !== undefined && limit !== null) ? limit : -9999,
        encoding: "json",
        options: (options !== undefined && options !== null) ? options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/get/records/bycolumn", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.json_encoded_response);
                delete data.json_encoded_response;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/get/records/bycolumn", actual_request);
        data.data = self.decode(data.json_encoded_response);
        delete data.json_encoded_response;
        return data;
    }
};
GPUdb.prototype.get_records_by_series_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        world_table_name: request.world_table_name,
        offset: (request.offset !== undefined && request.offset !== null) ? request.offset : 0,
        limit: (request.limit !== undefined && request.limit !== null) ? request.limit : 250,
        encoding: (request.encoding !== undefined && request.encoding !== null) ? request.encoding : "json",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/get/records/byseries", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.list_records_json);
                delete data.list_records_json;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/get/records/byseries", actual_request);
        data.data = self.decode(data.list_records_json);
        delete data.list_records_json;
        return data;
    }
};
GPUdb.prototype.get_records_by_series = function(table_name, world_table_name, offset, limit, options, callback) {
    var actual_request = {
        table_name: table_name,
        world_table_name: world_table_name,
        offset: (offset !== undefined && offset !== null) ? offset : 0,
        limit: (limit !== undefined && limit !== null) ? limit : 250,
        encoding: "json",
        options: (options !== undefined && options !== null) ? options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/get/records/byseries", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.list_records_json);
                delete data.list_records_json;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/get/records/byseries", actual_request);
        data.data = self.decode(data.list_records_json);
        delete data.list_records_json;
        return data;
    }
};
GPUdb.prototype.get_records_from_collection_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        offset: (request.offset !== undefined && request.offset !== null) ? request.offset : 0,
        limit: (request.limit !== undefined && request.limit !== null) ? request.limit : -9999,
        encoding: (request.encoding !== undefined && request.encoding !== null) ? request.encoding : "json",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/get/records/fromcollection", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.records_json);
                delete data.records_json;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/get/records/fromcollection", actual_request);
        data.data = self.decode(data.records_json);
        delete data.records_json;
        return data;
    }
};
GPUdb.prototype.get_records_from_collection = function(table_name, offset, limit, options, callback) {
    var actual_request = {
        table_name: table_name,
        offset: (offset !== undefined && offset !== null) ? offset : 0,
        limit: (limit !== undefined && limit !== null) ? limit : -9999,
        encoding: "json",
        options: (options !== undefined && options !== null) ? options : {}
    };

    var self = this;

    if (callback !== undefined && callback !== null) {
        this.submit_request("/get/records/fromcollection", actual_request, function(err, data) {
            if (err === null) {
                data.data = self.decode(data.records_json);
                delete data.records_json;
            }

            callback(err, data);
        });
    } else {
        var data = this.submit_request("/get/records/fromcollection", actual_request);
        data.data = self.decode(data.records_json);
        delete data.records_json;
        return data;
    }
};
GPUdb.prototype.get_vectortile_request = function(request, callback) {
    var actual_request = {
        table_names: request.table_names,
        column_names: request.column_names,
        layers: request.layers,
        tile_x: request.tile_x,
        tile_y: request.tile_y,
        zoom: request.zoom,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/get/vectortile", actual_request, callback);
    } else {
        var data = this.submit_request("/get/vectortile", actual_request);
        return data;
    }
};
GPUdb.prototype.get_vectortile = function(table_names, column_names, layers, tile_x, tile_y, zoom, options, callback) {
    var actual_request = {
        table_names: table_names,
        column_names: column_names,
        layers: layers,
        tile_x: tile_x,
        tile_y: tile_y,
        zoom: zoom,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/get/vectortile", actual_request, callback);
    } else {
        var data = this.submit_request("/get/vectortile", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission_request = function(request, callback) {
    var actual_request = {
        principal: (request.principal !== undefined && request.principal !== null) ? request.principal : "",
        object: request.object,
        object_type: request.object_type,
        permission: request.permission,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission = function(principal, object, object_type, permission, options, callback) {
    var actual_request = {
        principal: (principal !== undefined && principal !== null) ? principal : "",
        object: object,
        object_type: object_type,
        permission: permission,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission_credential_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        permission: request.permission,
        credential_name: request.credential_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission/credential", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission/credential", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission_credential = function(name, permission, credential_name, options, callback) {
    var actual_request = {
        name: name,
        permission: permission,
        credential_name: credential_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission/credential", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission/credential", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission_datasource_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        permission: request.permission,
        datasource_name: request.datasource_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission/datasource", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission/datasource", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission_datasource = function(name, permission, datasource_name, options, callback) {
    var actual_request = {
        name: name,
        permission: permission,
        datasource_name: datasource_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission/datasource", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission/datasource", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission_directory_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        permission: request.permission,
        directory_name: request.directory_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission/directory", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission/directory", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission_directory = function(name, permission, directory_name, options, callback) {
    var actual_request = {
        name: name,
        permission: permission,
        directory_name: directory_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission/directory", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission/directory", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission_proc_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        permission: request.permission,
        proc_name: request.proc_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission_proc = function(name, permission, proc_name, options, callback) {
    var actual_request = {
        name: name,
        permission: permission,
        proc_name: proc_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission_system_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        permission: request.permission,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission/system", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission/system", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission_system = function(name, permission, options, callback) {
    var actual_request = {
        name: name,
        permission: permission,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission/system", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission/system", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission_table_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        permission: request.permission,
        table_name: request.table_name,
        filter_expression: (request.filter_expression !== undefined && request.filter_expression !== null) ? request.filter_expression : "",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission/table", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission/table", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_permission_table = function(name, permission, table_name, filter_expression, options, callback) {
    var actual_request = {
        name: name,
        permission: permission,
        table_name: table_name,
        filter_expression: (filter_expression !== undefined && filter_expression !== null) ? filter_expression : "",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/permission/table", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/permission/table", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_role_request = function(request, callback) {
    var actual_request = {
        role: request.role,
        member: request.member,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/role", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/role", actual_request);
        return data;
    }
};
GPUdb.prototype.grant_role = function(role, member, options, callback) {
    var actual_request = {
        role: role,
        member: member,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/grant/role", actual_request, callback);
    } else {
        var data = this.submit_request("/grant/role", actual_request);
        return data;
    }
};
GPUdb.prototype.has_permission_request = function(request, callback) {
    var actual_request = {
        principal: (request.principal !== undefined && request.principal !== null) ? request.principal : "",
        object: request.object,
        object_type: request.object_type,
        permission: request.permission,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/has/permission", actual_request, callback);
    } else {
        var data = this.submit_request("/has/permission", actual_request);
        return data;
    }
};
GPUdb.prototype.has_permission = function(principal, object, object_type, permission, options, callback) {
    var actual_request = {
        principal: (principal !== undefined && principal !== null) ? principal : "",
        object: object,
        object_type: object_type,
        permission: permission,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/has/permission", actual_request, callback);
    } else {
        var data = this.submit_request("/has/permission", actual_request);
        return data;
    }
};
GPUdb.prototype.has_proc_request = function(request, callback) {
    var actual_request = {
        proc_name: request.proc_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/has/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/has/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.has_proc = function(proc_name, options, callback) {
    var actual_request = {
        proc_name: proc_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/has/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/has/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.has_role_request = function(request, callback) {
    var actual_request = {
        principal: (request.principal !== undefined && request.principal !== null) ? request.principal : "",
        role: request.role,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/has/role", actual_request, callback);
    } else {
        var data = this.submit_request("/has/role", actual_request);
        return data;
    }
};
GPUdb.prototype.has_role = function(principal, role, options, callback) {
    var actual_request = {
        principal: (principal !== undefined && principal !== null) ? principal : "",
        role: role,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/has/role", actual_request, callback);
    } else {
        var data = this.submit_request("/has/role", actual_request);
        return data;
    }
};
GPUdb.prototype.has_schema_request = function(request, callback) {
    var actual_request = {
        schema_name: request.schema_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/has/schema", actual_request, callback);
    } else {
        var data = this.submit_request("/has/schema", actual_request);
        return data;
    }
};
GPUdb.prototype.has_schema = function(schema_name, options, callback) {
    var actual_request = {
        schema_name: schema_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/has/schema", actual_request, callback);
    } else {
        var data = this.submit_request("/has/schema", actual_request);
        return data;
    }
};
GPUdb.prototype.has_table_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/has/table", actual_request, callback);
    } else {
        var data = this.submit_request("/has/table", actual_request);
        return data;
    }
};
GPUdb.prototype.has_table = function(table_name, options, callback) {
    var actual_request = {
        table_name: table_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/has/table", actual_request, callback);
    } else {
        var data = this.submit_request("/has/table", actual_request);
        return data;
    }
};
GPUdb.prototype.has_type_request = function(request, callback) {
    var actual_request = {
        type_id: request.type_id,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/has/type", actual_request, callback);
    } else {
        var data = this.submit_request("/has/type", actual_request);
        return data;
    }
};
GPUdb.prototype.has_type = function(type_id, options, callback) {
    var actual_request = {
        type_id: type_id,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/has/type", actual_request, callback);
    } else {
        var data = this.submit_request("/has/type", actual_request);
        return data;
    }
};
GPUdb.prototype.import_model_request = function(request, callback) {
    var actual_request = {
        model_name: request.model_name,
        registry_name: request.registry_name,
        container: request.container,
        run_function: request.run_function,
        model_type: request.model_type,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/import/model", actual_request, callback);
    } else {
        var data = this.submit_request("/import/model", actual_request);
        return data;
    }
};
GPUdb.prototype.import_model = function(model_name, registry_name, container, run_function, model_type, options, callback) {
    var actual_request = {
        model_name: model_name,
        registry_name: registry_name,
        container: container,
        run_function: run_function,
        model_type: model_type,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/import/model", actual_request, callback);
    } else {
        var data = this.submit_request("/import/model", actual_request);
        return data;
    }
};
GPUdb.prototype.insert_records_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        list: (request.list !== undefined && request.list !== null) ? request.list : [],
        list_str: (request.data !== undefined && request.data !== null) ? GPUdb.encode(request.data) : [],
        list_encoding: (request.list_encoding !== undefined && request.list_encoding !== null) ? request.list_encoding : "json",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/insert/records", actual_request, callback);
    } else {
        var data = this.submit_request("/insert/records", actual_request);
        return data;
    }
};
GPUdb.prototype.insert_records = function(table_name, data, options, callback) {
    var actual_request = {
        table_name: table_name,
        list: [],
        list_str: GPUdb.encode(data),
        list_encoding: "json",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/insert/records", actual_request, callback);
    } else {
        var data = this.submit_request("/insert/records", actual_request);
        return data;
    }
};
GPUdb.prototype.insert_records_from_files_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        filepaths: request.filepaths,
        modify_columns: (request.modify_columns !== undefined && request.modify_columns !== null) ? request.modify_columns : {},
        create_table_options: (request.create_table_options !== undefined && request.create_table_options !== null) ? request.create_table_options : {},
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/insert/records/fromfiles", actual_request, callback);
    } else {
        var data = this.submit_request("/insert/records/fromfiles", actual_request);
        return data;
    }
};
GPUdb.prototype.insert_records_from_files = function(table_name, filepaths, modify_columns, create_table_options, options, callback) {
    var actual_request = {
        table_name: table_name,
        filepaths: filepaths,
        modify_columns: (modify_columns !== undefined && modify_columns !== null) ? modify_columns : {},
        create_table_options: (create_table_options !== undefined && create_table_options !== null) ? create_table_options : {},
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/insert/records/fromfiles", actual_request, callback);
    } else {
        var data = this.submit_request("/insert/records/fromfiles", actual_request);
        return data;
    }
};
GPUdb.prototype.insert_records_from_payload_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        data_text: request.data_text,
        data_bytes: request.data_bytes,
        modify_columns: (request.modify_columns !== undefined && request.modify_columns !== null) ? request.modify_columns : {},
        create_table_options: (request.create_table_options !== undefined && request.create_table_options !== null) ? request.create_table_options : {},
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/insert/records/frompayload", actual_request, callback);
    } else {
        var data = this.submit_request("/insert/records/frompayload", actual_request);
        return data;
    }
};
GPUdb.prototype.insert_records_from_payload = function(table_name, data_text, data_bytes, modify_columns, create_table_options, options, callback) {
    var actual_request = {
        table_name: table_name,
        data_text: data_text,
        data_bytes: data_bytes,
        modify_columns: (modify_columns !== undefined && modify_columns !== null) ? modify_columns : {},
        create_table_options: (create_table_options !== undefined && create_table_options !== null) ? create_table_options : {},
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/insert/records/frompayload", actual_request, callback);
    } else {
        var data = this.submit_request("/insert/records/frompayload", actual_request);
        return data;
    }
};
GPUdb.prototype.insert_records_from_query_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        remote_query: request.remote_query,
        modify_columns: (request.modify_columns !== undefined && request.modify_columns !== null) ? request.modify_columns : {},
        create_table_options: (request.create_table_options !== undefined && request.create_table_options !== null) ? request.create_table_options : {},
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/insert/records/fromquery", actual_request, callback);
    } else {
        var data = this.submit_request("/insert/records/fromquery", actual_request);
        return data;
    }
};
GPUdb.prototype.insert_records_from_query = function(table_name, remote_query, modify_columns, create_table_options, options, callback) {
    var actual_request = {
        table_name: table_name,
        remote_query: remote_query,
        modify_columns: (modify_columns !== undefined && modify_columns !== null) ? modify_columns : {},
        create_table_options: (create_table_options !== undefined && create_table_options !== null) ? create_table_options : {},
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/insert/records/fromquery", actual_request, callback);
    } else {
        var data = this.submit_request("/insert/records/fromquery", actual_request);
        return data;
    }
};
GPUdb.prototype.insert_records_random_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        count: request.count,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/insert/records/random", actual_request, callback);
    } else {
        var data = this.submit_request("/insert/records/random", actual_request);
        return data;
    }
};
GPUdb.prototype.insert_records_random = function(table_name, count, options, callback) {
    var actual_request = {
        table_name: table_name,
        count: count,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/insert/records/random", actual_request, callback);
    } else {
        var data = this.submit_request("/insert/records/random", actual_request);
        return data;
    }
};
GPUdb.prototype.insert_symbol_request = function(request, callback) {
    var actual_request = {
        symbol_id: request.symbol_id,
        symbol_format: request.symbol_format,
        symbol_data: request.symbol_data,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/insert/symbol", actual_request, callback);
    } else {
        var data = this.submit_request("/insert/symbol", actual_request);
        return data;
    }
};
GPUdb.prototype.insert_symbol = function(symbol_id, symbol_format, symbol_data, options, callback) {
    var actual_request = {
        symbol_id: symbol_id,
        symbol_format: symbol_format,
        symbol_data: symbol_data,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/insert/symbol", actual_request, callback);
    } else {
        var data = this.submit_request("/insert/symbol", actual_request);
        return data;
    }
};
GPUdb.prototype.kill_proc_request = function(request, callback) {
    var actual_request = {
        run_id: (request.run_id !== undefined && request.run_id !== null) ? request.run_id : "",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/kill/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/kill/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.kill_proc = function(run_id, options, callback) {
    var actual_request = {
        run_id: (run_id !== undefined && run_id !== null) ? run_id : "",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/kill/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/kill/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.list_graph_request = function(request, callback) {
    var actual_request = {
        graph_name: (request.graph_name !== undefined && request.graph_name !== null) ? request.graph_name : "",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/list/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/list/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.list_graph = function(graph_name, options, callback) {
    var actual_request = {
        graph_name: (graph_name !== undefined && graph_name !== null) ? graph_name : "",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/list/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/list/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.lock_table_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        lock_type: (request.lock_type !== undefined && request.lock_type !== null) ? request.lock_type : "status",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/lock/table", actual_request, callback);
    } else {
        var data = this.submit_request("/lock/table", actual_request);
        return data;
    }
};
GPUdb.prototype.lock_table = function(table_name, lock_type, options, callback) {
    var actual_request = {
        table_name: table_name,
        lock_type: (lock_type !== undefined && lock_type !== null) ? lock_type : "status",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/lock/table", actual_request, callback);
    } else {
        var data = this.submit_request("/lock/table", actual_request);
        return data;
    }
};
GPUdb.prototype.match_graph_request = function(request, callback) {
    var actual_request = {
        graph_name: request.graph_name,
        sample_points: request.sample_points,
        solve_method: (request.solve_method !== undefined && request.solve_method !== null) ? request.solve_method : "markov_chain",
        solution_table: (request.solution_table !== undefined && request.solution_table !== null) ? request.solution_table : "",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/match/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/match/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.match_graph = function(graph_name, sample_points, solve_method, solution_table, options, callback) {
    var actual_request = {
        graph_name: graph_name,
        sample_points: sample_points,
        solve_method: (solve_method !== undefined && solve_method !== null) ? solve_method : "markov_chain",
        solution_table: (solution_table !== undefined && solution_table !== null) ? solution_table : "",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/match/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/match/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.merge_records_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        source_table_names: request.source_table_names,
        field_maps: request.field_maps,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/merge/records", actual_request, callback);
    } else {
        var data = this.submit_request("/merge/records", actual_request);
        return data;
    }
};
GPUdb.prototype.merge_records = function(table_name, source_table_names, field_maps, options, callback) {
    var actual_request = {
        table_name: table_name,
        source_table_names: source_table_names,
        field_maps: field_maps,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/merge/records", actual_request, callback);
    } else {
        var data = this.submit_request("/merge/records", actual_request);
        return data;
    }
};
GPUdb.prototype.modify_graph_request = function(request, callback) {
    var actual_request = {
        graph_name: request.graph_name,
        nodes: request.nodes,
        edges: request.edges,
        weights: request.weights,
        restrictions: request.restrictions,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/modify/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/modify/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.modify_graph = function(graph_name, nodes, edges, weights, restrictions, options, callback) {
    var actual_request = {
        graph_name: graph_name,
        nodes: nodes,
        edges: edges,
        weights: weights,
        restrictions: restrictions,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/modify/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/modify/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.query_graph_request = function(request, callback) {
    var actual_request = {
        graph_name: request.graph_name,
        queries: request.queries,
        restrictions: (request.restrictions !== undefined && request.restrictions !== null) ? request.restrictions : [],
        adjacency_table: (request.adjacency_table !== undefined && request.adjacency_table !== null) ? request.adjacency_table : "",
        rings: (request.rings !== undefined && request.rings !== null) ? request.rings : 1,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/query/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/query/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.query_graph = function(graph_name, queries, restrictions, adjacency_table, rings, options, callback) {
    var actual_request = {
        graph_name: graph_name,
        queries: queries,
        restrictions: (restrictions !== undefined && restrictions !== null) ? restrictions : [],
        adjacency_table: (adjacency_table !== undefined && adjacency_table !== null) ? adjacency_table : "",
        rings: (rings !== undefined && rings !== null) ? rings : 1,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/query/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/query/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.repartition_graph_request = function(request, callback) {
    var actual_request = {
        graph_name: request.graph_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/repartition/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/repartition/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.repartition_graph = function(graph_name, options, callback) {
    var actual_request = {
        graph_name: graph_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/repartition/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/repartition/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.reserve_resource_request = function(request, callback) {
    var actual_request = {
        component: request.component,
        name: request.name,
        action: request.action,
        bytes_requested: (request.bytes_requested !== undefined && request.bytes_requested !== null) ? request.bytes_requested : 0,
        owner_id: (request.owner_id !== undefined && request.owner_id !== null) ? request.owner_id : 0,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/reserve/resource", actual_request, callback);
    } else {
        var data = this.submit_request("/reserve/resource", actual_request);
        return data;
    }
};
GPUdb.prototype.reserve_resource = function(component, name, action, bytes_requested, owner_id, options, callback) {
    var actual_request = {
        component: component,
        name: name,
        action: action,
        bytes_requested: (bytes_requested !== undefined && bytes_requested !== null) ? bytes_requested : 0,
        owner_id: (owner_id !== undefined && owner_id !== null) ? owner_id : 0,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/reserve/resource", actual_request, callback);
    } else {
        var data = this.submit_request("/reserve/resource", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission_request = function(request, callback) {
    var actual_request = {
        principal: (request.principal !== undefined && request.principal !== null) ? request.principal : "",
        object: request.object,
        object_type: request.object_type,
        permission: request.permission,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission = function(principal, object, object_type, permission, options, callback) {
    var actual_request = {
        principal: (principal !== undefined && principal !== null) ? principal : "",
        object: object,
        object_type: object_type,
        permission: permission,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission_credential_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        permission: request.permission,
        credential_name: request.credential_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission/credential", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission/credential", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission_credential = function(name, permission, credential_name, options, callback) {
    var actual_request = {
        name: name,
        permission: permission,
        credential_name: credential_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission/credential", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission/credential", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission_datasource_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        permission: request.permission,
        datasource_name: request.datasource_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission/datasource", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission/datasource", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission_datasource = function(name, permission, datasource_name, options, callback) {
    var actual_request = {
        name: name,
        permission: permission,
        datasource_name: datasource_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission/datasource", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission/datasource", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission_directory_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        permission: request.permission,
        directory_name: request.directory_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission/directory", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission/directory", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission_directory = function(name, permission, directory_name, options, callback) {
    var actual_request = {
        name: name,
        permission: permission,
        directory_name: directory_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission/directory", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission/directory", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission_proc_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        permission: request.permission,
        proc_name: request.proc_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission_proc = function(name, permission, proc_name, options, callback) {
    var actual_request = {
        name: name,
        permission: permission,
        proc_name: proc_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission_system_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        permission: request.permission,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission/system", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission/system", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission_system = function(name, permission, options, callback) {
    var actual_request = {
        name: name,
        permission: permission,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission/system", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission/system", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission_table_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        permission: request.permission,
        table_name: request.table_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission/table", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission/table", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_permission_table = function(name, permission, table_name, options, callback) {
    var actual_request = {
        name: name,
        permission: permission,
        table_name: table_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/permission/table", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/permission/table", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_role_request = function(request, callback) {
    var actual_request = {
        role: request.role,
        member: request.member,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/role", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/role", actual_request);
        return data;
    }
};
GPUdb.prototype.revoke_role = function(role, member, options, callback) {
    var actual_request = {
        role: role,
        member: member,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/revoke/role", actual_request, callback);
    } else {
        var data = this.submit_request("/revoke/role", actual_request);
        return data;
    }
};
GPUdb.prototype.show_container_registry_request = function(request, callback) {
    var actual_request = {
        registry_name: request.registry_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/container/registry", actual_request, callback);
    } else {
        var data = this.submit_request("/show/container/registry", actual_request);
        return data;
    }
};
GPUdb.prototype.show_container_registry = function(registry_name, options, callback) {
    var actual_request = {
        registry_name: registry_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/container/registry", actual_request, callback);
    } else {
        var data = this.submit_request("/show/container/registry", actual_request);
        return data;
    }
};
GPUdb.prototype.show_credential_request = function(request, callback) {
    var actual_request = {
        credential_name: request.credential_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/credential", actual_request, callback);
    } else {
        var data = this.submit_request("/show/credential", actual_request);
        return data;
    }
};
GPUdb.prototype.show_credential = function(credential_name, options, callback) {
    var actual_request = {
        credential_name: credential_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/credential", actual_request, callback);
    } else {
        var data = this.submit_request("/show/credential", actual_request);
        return data;
    }
};
GPUdb.prototype.show_datasink_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/datasink", actual_request, callback);
    } else {
        var data = this.submit_request("/show/datasink", actual_request);
        return data;
    }
};
GPUdb.prototype.show_datasink = function(name, options, callback) {
    var actual_request = {
        name: name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/datasink", actual_request, callback);
    } else {
        var data = this.submit_request("/show/datasink", actual_request);
        return data;
    }
};
GPUdb.prototype.show_datasource_request = function(request, callback) {
    var actual_request = {
        name: request.name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/datasource", actual_request, callback);
    } else {
        var data = this.submit_request("/show/datasource", actual_request);
        return data;
    }
};
GPUdb.prototype.show_datasource = function(name, options, callback) {
    var actual_request = {
        name: name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/datasource", actual_request, callback);
    } else {
        var data = this.submit_request("/show/datasource", actual_request);
        return data;
    }
};
GPUdb.prototype.show_directories_request = function(request, callback) {
    var actual_request = {
        directory_name: (request.directory_name !== undefined && request.directory_name !== null) ? request.directory_name : "",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/directories", actual_request, callback);
    } else {
        var data = this.submit_request("/show/directories", actual_request);
        return data;
    }
};
GPUdb.prototype.show_directories = function(directory_name, options, callback) {
    var actual_request = {
        directory_name: (directory_name !== undefined && directory_name !== null) ? directory_name : "",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/directories", actual_request, callback);
    } else {
        var data = this.submit_request("/show/directories", actual_request);
        return data;
    }
};
GPUdb.prototype.show_files_request = function(request, callback) {
    var actual_request = {
        paths: request.paths,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/files", actual_request, callback);
    } else {
        var data = this.submit_request("/show/files", actual_request);
        return data;
    }
};
GPUdb.prototype.show_files = function(paths, options, callback) {
    var actual_request = {
        paths: paths,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/files", actual_request, callback);
    } else {
        var data = this.submit_request("/show/files", actual_request);
        return data;
    }
};
GPUdb.prototype.show_functions_request = function(request, callback) {
    var actual_request = {
        names: request.names,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/functions", actual_request, callback);
    } else {
        var data = this.submit_request("/show/functions", actual_request);
        return data;
    }
};
GPUdb.prototype.show_functions = function(names, options, callback) {
    var actual_request = {
        names: names,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/functions", actual_request, callback);
    } else {
        var data = this.submit_request("/show/functions", actual_request);
        return data;
    }
};
GPUdb.prototype.show_graph_request = function(request, callback) {
    var actual_request = {
        graph_name: (request.graph_name !== undefined && request.graph_name !== null) ? request.graph_name : "",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/show/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.show_graph = function(graph_name, options, callback) {
    var actual_request = {
        graph_name: (graph_name !== undefined && graph_name !== null) ? graph_name : "",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/show/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.show_graph_grammar_request = function(request, callback) {
    var actual_request = {
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/graph/grammar", actual_request, callback);
    } else {
        var data = this.submit_request("/show/graph/grammar", actual_request);
        return data;
    }
};
GPUdb.prototype.show_graph_grammar = function(options, callback) {
    var actual_request = {
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/graph/grammar", actual_request, callback);
    } else {
        var data = this.submit_request("/show/graph/grammar", actual_request);
        return data;
    }
};
GPUdb.prototype.show_model_request = function(request, callback) {
    var actual_request = {
        model_names: (request.model_names !== undefined && request.model_names !== null) ? request.model_names : {},
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/model", actual_request, callback);
    } else {
        var data = this.submit_request("/show/model", actual_request);
        return data;
    }
};
GPUdb.prototype.show_model = function(model_names, options, callback) {
    var actual_request = {
        model_names: (model_names !== undefined && model_names !== null) ? model_names : {},
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/model", actual_request, callback);
    } else {
        var data = this.submit_request("/show/model", actual_request);
        return data;
    }
};
GPUdb.prototype.show_proc_request = function(request, callback) {
    var actual_request = {
        proc_name: (request.proc_name !== undefined && request.proc_name !== null) ? request.proc_name : "",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/show/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.show_proc = function(proc_name, options, callback) {
    var actual_request = {
        proc_name: (proc_name !== undefined && proc_name !== null) ? proc_name : "",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/show/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.show_proc_status_request = function(request, callback) {
    var actual_request = {
        run_id: (request.run_id !== undefined && request.run_id !== null) ? request.run_id : "",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/proc/status", actual_request, callback);
    } else {
        var data = this.submit_request("/show/proc/status", actual_request);
        return data;
    }
};
GPUdb.prototype.show_proc_status = function(run_id, options, callback) {
    var actual_request = {
        run_id: (run_id !== undefined && run_id !== null) ? run_id : "",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/proc/status", actual_request, callback);
    } else {
        var data = this.submit_request("/show/proc/status", actual_request);
        return data;
    }
};
GPUdb.prototype.show_resource_objects_request = function(request, callback) {
    var actual_request = {
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/resource/objects", actual_request, callback);
    } else {
        var data = this.submit_request("/show/resource/objects", actual_request);
        return data;
    }
};
GPUdb.prototype.show_resource_objects = function(options, callback) {
    var actual_request = {
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/resource/objects", actual_request, callback);
    } else {
        var data = this.submit_request("/show/resource/objects", actual_request);
        return data;
    }
};
GPUdb.prototype.show_resource_statistics_request = function(request, callback) {
    var actual_request = {
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/resource/statistics", actual_request, callback);
    } else {
        var data = this.submit_request("/show/resource/statistics", actual_request);
        return data;
    }
};
GPUdb.prototype.show_resource_statistics = function(options, callback) {
    var actual_request = {
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/resource/statistics", actual_request, callback);
    } else {
        var data = this.submit_request("/show/resource/statistics", actual_request);
        return data;
    }
};
GPUdb.prototype.show_resource_groups_request = function(request, callback) {
    var actual_request = {
        names: request.names,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/resourcegroups", actual_request, callback);
    } else {
        var data = this.submit_request("/show/resourcegroups", actual_request);
        return data;
    }
};
GPUdb.prototype.show_resource_groups = function(names, options, callback) {
    var actual_request = {
        names: names,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/resourcegroups", actual_request, callback);
    } else {
        var data = this.submit_request("/show/resourcegroups", actual_request);
        return data;
    }
};
GPUdb.prototype.show_schema_request = function(request, callback) {
    var actual_request = {
        schema_name: request.schema_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/schema", actual_request, callback);
    } else {
        var data = this.submit_request("/show/schema", actual_request);
        return data;
    }
};
GPUdb.prototype.show_schema = function(schema_name, options, callback) {
    var actual_request = {
        schema_name: schema_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/schema", actual_request, callback);
    } else {
        var data = this.submit_request("/show/schema", actual_request);
        return data;
    }
};
GPUdb.prototype.show_security_request = function(request, callback) {
    var actual_request = {
        names: request.names,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/security", actual_request, callback);
    } else {
        var data = this.submit_request("/show/security", actual_request);
        return data;
    }
};
GPUdb.prototype.show_security = function(names, options, callback) {
    var actual_request = {
        names: names,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/security", actual_request, callback);
    } else {
        var data = this.submit_request("/show/security", actual_request);
        return data;
    }
};
GPUdb.prototype.show_sql_proc_request = function(request, callback) {
    var actual_request = {
        procedure_name: (request.procedure_name !== undefined && request.procedure_name !== null) ? request.procedure_name : "",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/sql/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/show/sql/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.show_sql_proc = function(procedure_name, options, callback) {
    var actual_request = {
        procedure_name: (procedure_name !== undefined && procedure_name !== null) ? procedure_name : "",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/sql/proc", actual_request, callback);
    } else {
        var data = this.submit_request("/show/sql/proc", actual_request);
        return data;
    }
};
GPUdb.prototype.show_statistics_request = function(request, callback) {
    var actual_request = {
        table_names: request.table_names,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/statistics", actual_request, callback);
    } else {
        var data = this.submit_request("/show/statistics", actual_request);
        return data;
    }
};
GPUdb.prototype.show_statistics = function(table_names, options, callback) {
    var actual_request = {
        table_names: table_names,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/statistics", actual_request, callback);
    } else {
        var data = this.submit_request("/show/statistics", actual_request);
        return data;
    }
};
GPUdb.prototype.show_system_properties_request = function(request, callback) {
    var actual_request = {
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/system/properties", actual_request, callback);
    } else {
        var data = this.submit_request("/show/system/properties", actual_request);
        return data;
    }
};
GPUdb.prototype.show_system_properties = function(options, callback) {
    var actual_request = {
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/system/properties", actual_request, callback);
    } else {
        var data = this.submit_request("/show/system/properties", actual_request);
        return data;
    }
};
GPUdb.prototype.show_system_status_request = function(request, callback) {
    var actual_request = {
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/system/status", actual_request, callback);
    } else {
        var data = this.submit_request("/show/system/status", actual_request);
        return data;
    }
};
GPUdb.prototype.show_system_status = function(options, callback) {
    var actual_request = {
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/system/status", actual_request, callback);
    } else {
        var data = this.submit_request("/show/system/status", actual_request);
        return data;
    }
};
GPUdb.prototype.show_system_timing_request = function(request, callback) {
    var actual_request = {
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/system/timing", actual_request, callback);
    } else {
        var data = this.submit_request("/show/system/timing", actual_request);
        return data;
    }
};
GPUdb.prototype.show_system_timing = function(options, callback) {
    var actual_request = {
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/system/timing", actual_request, callback);
    } else {
        var data = this.submit_request("/show/system/timing", actual_request);
        return data;
    }
};
GPUdb.prototype.show_table_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/table", actual_request, callback);
    } else {
        var data = this.submit_request("/show/table", actual_request);
        return data;
    }
};
GPUdb.prototype.show_table = function(table_name, options, callback) {
    var actual_request = {
        table_name: table_name,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/table", actual_request, callback);
    } else {
        var data = this.submit_request("/show/table", actual_request);
        return data;
    }
};
GPUdb.prototype.show_table_metadata_request = function(request, callback) {
    var actual_request = {
        table_names: request.table_names,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/table/metadata", actual_request, callback);
    } else {
        var data = this.submit_request("/show/table/metadata", actual_request);
        return data;
    }
};
GPUdb.prototype.show_table_metadata = function(table_names, options, callback) {
    var actual_request = {
        table_names: table_names,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/table/metadata", actual_request, callback);
    } else {
        var data = this.submit_request("/show/table/metadata", actual_request);
        return data;
    }
};
GPUdb.prototype.show_table_monitors_request = function(request, callback) {
    var actual_request = {
        monitor_ids: request.monitor_ids,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/tablemonitors", actual_request, callback);
    } else {
        var data = this.submit_request("/show/tablemonitors", actual_request);
        return data;
    }
};
GPUdb.prototype.show_table_monitors = function(monitor_ids, options, callback) {
    var actual_request = {
        monitor_ids: monitor_ids,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/tablemonitors", actual_request, callback);
    } else {
        var data = this.submit_request("/show/tablemonitors", actual_request);
        return data;
    }
};
GPUdb.prototype.show_tables_by_type_request = function(request, callback) {
    var actual_request = {
        type_id: request.type_id,
        label: request.label,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/tables/bytype", actual_request, callback);
    } else {
        var data = this.submit_request("/show/tables/bytype", actual_request);
        return data;
    }
};
GPUdb.prototype.show_tables_by_type = function(type_id, label, options, callback) {
    var actual_request = {
        type_id: type_id,
        label: label,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/tables/bytype", actual_request, callback);
    } else {
        var data = this.submit_request("/show/tables/bytype", actual_request);
        return data;
    }
};
GPUdb.prototype.show_triggers_request = function(request, callback) {
    var actual_request = {
        trigger_ids: request.trigger_ids,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/triggers", actual_request, callback);
    } else {
        var data = this.submit_request("/show/triggers", actual_request);
        return data;
    }
};
GPUdb.prototype.show_triggers = function(trigger_ids, options, callback) {
    var actual_request = {
        trigger_ids: trigger_ids,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/triggers", actual_request, callback);
    } else {
        var data = this.submit_request("/show/triggers", actual_request);
        return data;
    }
};
GPUdb.prototype.show_types_request = function(request, callback) {
    var actual_request = {
        type_id: request.type_id,
        label: request.label,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/types", actual_request, callback);
    } else {
        var data = this.submit_request("/show/types", actual_request);
        return data;
    }
};
GPUdb.prototype.show_types = function(type_id, label, options, callback) {
    var actual_request = {
        type_id: type_id,
        label: label,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/types", actual_request, callback);
    } else {
        var data = this.submit_request("/show/types", actual_request);
        return data;
    }
};
GPUdb.prototype.show_video_request = function(request, callback) {
    var actual_request = {
        paths: request.paths,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/video", actual_request, callback);
    } else {
        var data = this.submit_request("/show/video", actual_request);
        return data;
    }
};
GPUdb.prototype.show_video = function(paths, options, callback) {
    var actual_request = {
        paths: paths,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/show/video", actual_request, callback);
    } else {
        var data = this.submit_request("/show/video", actual_request);
        return data;
    }
};
GPUdb.prototype.solve_graph_request = function(request, callback) {
    var actual_request = {
        graph_name: request.graph_name,
        weights_on_edges: (request.weights_on_edges !== undefined && request.weights_on_edges !== null) ? request.weights_on_edges : [],
        restrictions: (request.restrictions !== undefined && request.restrictions !== null) ? request.restrictions : [],
        solver_type: (request.solver_type !== undefined && request.solver_type !== null) ? request.solver_type : "SHORTEST_PATH",
        source_nodes: (request.source_nodes !== undefined && request.source_nodes !== null) ? request.source_nodes : [],
        destination_nodes: (request.destination_nodes !== undefined && request.destination_nodes !== null) ? request.destination_nodes : [],
        solution_table: (request.solution_table !== undefined && request.solution_table !== null) ? request.solution_table : "graph_solutions",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/solve/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/solve/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.solve_graph = function(graph_name, weights_on_edges, restrictions, solver_type, source_nodes, destination_nodes, solution_table, options, callback) {
    var actual_request = {
        graph_name: graph_name,
        weights_on_edges: (weights_on_edges !== undefined && weights_on_edges !== null) ? weights_on_edges : [],
        restrictions: (restrictions !== undefined && restrictions !== null) ? restrictions : [],
        solver_type: (solver_type !== undefined && solver_type !== null) ? solver_type : "SHORTEST_PATH",
        source_nodes: (source_nodes !== undefined && source_nodes !== null) ? source_nodes : [],
        destination_nodes: (destination_nodes !== undefined && destination_nodes !== null) ? destination_nodes : [],
        solution_table: (solution_table !== undefined && solution_table !== null) ? solution_table : "graph_solutions",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/solve/graph", actual_request, callback);
    } else {
        var data = this.submit_request("/solve/graph", actual_request);
        return data;
    }
};
GPUdb.prototype.update_records_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        expressions: request.expressions,
        new_values_maps: request.new_values_maps,
        records_to_insert: (request.records_to_insert !== undefined && request.records_to_insert !== null) ? request.records_to_insert : [],
        records_to_insert_str: (request.data !== undefined && request.data !== null) ? GPUdb.encode(request.data) : [],
        record_encoding: (request.record_encoding !== undefined && request.record_encoding !== null) ? request.record_encoding : "json",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/update/records", actual_request, callback);
    } else {
        var data = this.submit_request("/update/records", actual_request);
        return data;
    }
};
GPUdb.prototype.update_records = function(table_name, expressions, new_values_maps, data, options, callback) {
    var actual_request = {
        table_name: table_name,
        expressions: expressions,
        new_values_maps: new_values_maps,
        records_to_insert: [],
        records_to_insert_str: GPUdb.encode(data),
        record_encoding: "json",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/update/records", actual_request, callback);
    } else {
        var data = this.submit_request("/update/records", actual_request);
        return data;
    }
};
GPUdb.prototype.update_records_by_series_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        world_table_name: request.world_table_name,
        view_name: (request.view_name !== undefined && request.view_name !== null) ? request.view_name : "",
        reserved: (request.reserved !== undefined && request.reserved !== null) ? request.reserved : [],
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/update/records/byseries", actual_request, callback);
    } else {
        var data = this.submit_request("/update/records/byseries", actual_request);
        return data;
    }
};
GPUdb.prototype.update_records_by_series = function(table_name, world_table_name, view_name, reserved, options, callback) {
    var actual_request = {
        table_name: table_name,
        world_table_name: world_table_name,
        view_name: (view_name !== undefined && view_name !== null) ? view_name : "",
        reserved: (reserved !== undefined && reserved !== null) ? reserved : [],
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/update/records/byseries", actual_request, callback);
    } else {
        var data = this.submit_request("/update/records/byseries", actual_request);
        return data;
    }
};
GPUdb.prototype.upload_files_request = function(request, callback) {
    var actual_request = {
        file_names: request.file_names,
        file_data: request.file_data,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/upload/files", actual_request, callback);
    } else {
        var data = this.submit_request("/upload/files", actual_request);
        return data;
    }
};
GPUdb.prototype.upload_files = function(file_names, file_data, options, callback) {
    var actual_request = {
        file_names: file_names,
        file_data: file_data,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/upload/files", actual_request, callback);
    } else {
        var data = this.submit_request("/upload/files", actual_request);
        return data;
    }
};
GPUdb.prototype.upload_files_fromurl_request = function(request, callback) {
    var actual_request = {
        file_names: request.file_names,
        urls: request.urls,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/upload/files/fromurl", actual_request, callback);
    } else {
        var data = this.submit_request("/upload/files/fromurl", actual_request);
        return data;
    }
};
GPUdb.prototype.upload_files_fromurl = function(file_names, urls, options, callback) {
    var actual_request = {
        file_names: file_names,
        urls: urls,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/upload/files/fromurl", actual_request, callback);
    } else {
        var data = this.submit_request("/upload/files/fromurl", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_get_feature_info_request = function(request, callback) {
    var actual_request = {
        table_names: request.table_names,
        x_column_names: request.x_column_names,
        y_column_names: request.y_column_names,
        geometry_column_names: request.geometry_column_names,
        query_column_names: request.query_column_names,
        projection: request.projection,
        min_x: request.min_x,
        max_x: request.max_x,
        min_y: request.min_y,
        max_y: request.max_y,
        width: request.width,
        height: request.height,
        x: request.x,
        y: request.y,
        radius: request.radius,
        limit: request.limit,
        encoding: request.encoding,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/getfeatureinfo", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/getfeatureinfo", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_get_feature_info = function(table_names, x_column_names, y_column_names, geometry_column_names, query_column_names, projection, min_x, max_x, min_y, max_y, width, height, x, y, radius, limit, encoding, options, callback) {
    var actual_request = {
        table_names: table_names,
        x_column_names: x_column_names,
        y_column_names: y_column_names,
        geometry_column_names: geometry_column_names,
        query_column_names: query_column_names,
        projection: projection,
        min_x: min_x,
        max_x: max_x,
        min_y: min_y,
        max_y: max_y,
        width: width,
        height: height,
        x: x,
        y: y,
        radius: radius,
        limit: limit,
        encoding: encoding,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/getfeatureinfo", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/getfeatureinfo", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_image_request = function(request, callback) {
    var actual_request = {
        table_names: request.table_names,
        world_table_names: request.world_table_names,
        x_column_name: request.x_column_name,
        y_column_name: request.y_column_name,
        symbol_column_name: request.symbol_column_name,
        geometry_column_name: request.geometry_column_name,
        track_ids: request.track_ids,
        min_x: request.min_x,
        max_x: request.max_x,
        min_y: request.min_y,
        max_y: request.max_y,
        width: request.width,
        height: request.height,
        projection: (request.projection !== undefined && request.projection !== null) ? request.projection : "PLATE_CARREE",
        bg_color: request.bg_color,
        style_options: request.style_options,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/image", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/image", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_image = function(table_names, world_table_names, x_column_name, y_column_name, symbol_column_name, geometry_column_name, track_ids, min_x, max_x, min_y, max_y, width, height, projection, bg_color, style_options, options, callback) {
    var actual_request = {
        table_names: table_names,
        world_table_names: world_table_names,
        x_column_name: x_column_name,
        y_column_name: y_column_name,
        symbol_column_name: symbol_column_name,
        geometry_column_name: geometry_column_name,
        track_ids: track_ids,
        min_x: min_x,
        max_x: max_x,
        min_y: min_y,
        max_y: max_y,
        width: width,
        height: height,
        projection: (projection !== undefined && projection !== null) ? projection : "PLATE_CARREE",
        bg_color: bg_color,
        style_options: style_options,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/image", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/image", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_image_chart_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        x_column_names: request.x_column_names,
        y_column_names: request.y_column_names,
        min_x: request.min_x,
        max_x: request.max_x,
        min_y: request.min_y,
        max_y: request.max_y,
        width: request.width,
        height: request.height,
        bg_color: request.bg_color,
        style_options: request.style_options,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/image/chart", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/image/chart", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_image_chart = function(table_name, x_column_names, y_column_names, min_x, max_x, min_y, max_y, width, height, bg_color, style_options, options, callback) {
    var actual_request = {
        table_name: table_name,
        x_column_names: x_column_names,
        y_column_names: y_column_names,
        min_x: min_x,
        max_x: max_x,
        min_y: min_y,
        max_y: max_y,
        width: width,
        height: height,
        bg_color: bg_color,
        style_options: style_options,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/image/chart", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/image/chart", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_image_classbreak_request = function(request, callback) {
    var actual_request = {
        table_names: request.table_names,
        world_table_names: request.world_table_names,
        x_column_name: request.x_column_name,
        y_column_name: request.y_column_name,
        symbol_column_name: request.symbol_column_name,
        geometry_column_name: request.geometry_column_name,
        track_ids: request.track_ids,
        cb_attr: request.cb_attr,
        cb_vals: request.cb_vals,
        cb_pointcolor_attr: request.cb_pointcolor_attr,
        cb_pointcolor_vals: request.cb_pointcolor_vals,
        cb_pointalpha_attr: request.cb_pointalpha_attr,
        cb_pointalpha_vals: request.cb_pointalpha_vals,
        cb_pointsize_attr: request.cb_pointsize_attr,
        cb_pointsize_vals: request.cb_pointsize_vals,
        cb_pointshape_attr: request.cb_pointshape_attr,
        cb_pointshape_vals: request.cb_pointshape_vals,
        min_x: request.min_x,
        max_x: request.max_x,
        min_y: request.min_y,
        max_y: request.max_y,
        width: request.width,
        height: request.height,
        projection: (request.projection !== undefined && request.projection !== null) ? request.projection : "PLATE_CARREE",
        bg_color: request.bg_color,
        style_options: request.style_options,
        options: (request.options !== undefined && request.options !== null) ? request.options : {},
        cb_transparency_vec: request.cb_transparency_vec
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/image/classbreak", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/image/classbreak", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_image_classbreak = function(table_names, world_table_names, x_column_name, y_column_name, symbol_column_name, geometry_column_name, track_ids, cb_attr, cb_vals, cb_pointcolor_attr, cb_pointcolor_vals, cb_pointalpha_attr, cb_pointalpha_vals, cb_pointsize_attr, cb_pointsize_vals, cb_pointshape_attr, cb_pointshape_vals, min_x, max_x, min_y, max_y, width, height, projection, bg_color, style_options, options, cb_transparency_vec, callback) {
    var actual_request = {
        table_names: table_names,
        world_table_names: world_table_names,
        x_column_name: x_column_name,
        y_column_name: y_column_name,
        symbol_column_name: symbol_column_name,
        geometry_column_name: geometry_column_name,
        track_ids: track_ids,
        cb_attr: cb_attr,
        cb_vals: cb_vals,
        cb_pointcolor_attr: cb_pointcolor_attr,
        cb_pointcolor_vals: cb_pointcolor_vals,
        cb_pointalpha_attr: cb_pointalpha_attr,
        cb_pointalpha_vals: cb_pointalpha_vals,
        cb_pointsize_attr: cb_pointsize_attr,
        cb_pointsize_vals: cb_pointsize_vals,
        cb_pointshape_attr: cb_pointshape_attr,
        cb_pointshape_vals: cb_pointshape_vals,
        min_x: min_x,
        max_x: max_x,
        min_y: min_y,
        max_y: max_y,
        width: width,
        height: height,
        projection: (projection !== undefined && projection !== null) ? projection : "PLATE_CARREE",
        bg_color: bg_color,
        style_options: style_options,
        options: (options !== undefined && options !== null) ? options : {},
        cb_transparency_vec: cb_transparency_vec
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/image/classbreak", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/image/classbreak", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_image_contour_request = function(request, callback) {
    var actual_request = {
        table_names: request.table_names,
        x_column_name: request.x_column_name,
        y_column_name: request.y_column_name,
        value_column_name: request.value_column_name,
        min_x: request.min_x,
        max_x: request.max_x,
        min_y: request.min_y,
        max_y: request.max_y,
        width: request.width,
        height: request.height,
        projection: (request.projection !== undefined && request.projection !== null) ? request.projection : "PLATE_CARREE",
        style_options: request.style_options,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/image/contour", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/image/contour", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_image_contour = function(table_names, x_column_name, y_column_name, value_column_name, min_x, max_x, min_y, max_y, width, height, projection, style_options, options, callback) {
    var actual_request = {
        table_names: table_names,
        x_column_name: x_column_name,
        y_column_name: y_column_name,
        value_column_name: value_column_name,
        min_x: min_x,
        max_x: max_x,
        min_y: min_y,
        max_y: max_y,
        width: width,
        height: height,
        projection: (projection !== undefined && projection !== null) ? projection : "PLATE_CARREE",
        style_options: style_options,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/image/contour", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/image/contour", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_image_heatmap_request = function(request, callback) {
    var actual_request = {
        table_names: request.table_names,
        x_column_name: request.x_column_name,
        y_column_name: request.y_column_name,
        value_column_name: request.value_column_name,
        geometry_column_name: request.geometry_column_name,
        min_x: request.min_x,
        max_x: request.max_x,
        min_y: request.min_y,
        max_y: request.max_y,
        width: request.width,
        height: request.height,
        projection: (request.projection !== undefined && request.projection !== null) ? request.projection : "PLATE_CARREE",
        style_options: request.style_options,
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/image/heatmap", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/image/heatmap", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_image_heatmap = function(table_names, x_column_name, y_column_name, value_column_name, geometry_column_name, min_x, max_x, min_y, max_y, width, height, projection, style_options, options, callback) {
    var actual_request = {
        table_names: table_names,
        x_column_name: x_column_name,
        y_column_name: y_column_name,
        value_column_name: value_column_name,
        geometry_column_name: geometry_column_name,
        min_x: min_x,
        max_x: max_x,
        min_y: min_y,
        max_y: max_y,
        width: width,
        height: height,
        projection: (projection !== undefined && projection !== null) ? projection : "PLATE_CARREE",
        style_options: style_options,
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/image/heatmap", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/image/heatmap", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_image_labels_request = function(request, callback) {
    var actual_request = {
        table_name: request.table_name,
        x_column_name: request.x_column_name,
        y_column_name: request.y_column_name,
        x_offset: (request.x_offset !== undefined && request.x_offset !== null) ? request.x_offset : "",
        y_offset: (request.y_offset !== undefined && request.y_offset !== null) ? request.y_offset : "",
        text_string: request.text_string,
        font: (request.font !== undefined && request.font !== null) ? request.font : "",
        text_color: (request.text_color !== undefined && request.text_color !== null) ? request.text_color : "",
        text_angle: (request.text_angle !== undefined && request.text_angle !== null) ? request.text_angle : "",
        text_scale: (request.text_scale !== undefined && request.text_scale !== null) ? request.text_scale : "",
        draw_box: (request.draw_box !== undefined && request.draw_box !== null) ? request.draw_box : "",
        draw_leader: (request.draw_leader !== undefined && request.draw_leader !== null) ? request.draw_leader : "",
        line_width: (request.line_width !== undefined && request.line_width !== null) ? request.line_width : "",
        line_color: (request.line_color !== undefined && request.line_color !== null) ? request.line_color : "",
        fill_color: (request.fill_color !== undefined && request.fill_color !== null) ? request.fill_color : "",
        leader_x_column_name: (request.leader_x_column_name !== undefined && request.leader_x_column_name !== null) ? request.leader_x_column_name : "",
        leader_y_column_name: (request.leader_y_column_name !== undefined && request.leader_y_column_name !== null) ? request.leader_y_column_name : "",
        filter: (request.filter !== undefined && request.filter !== null) ? request.filter : "",
        min_x: request.min_x,
        max_x: request.max_x,
        min_y: request.min_y,
        max_y: request.max_y,
        width: request.width,
        height: request.height,
        projection: (request.projection !== undefined && request.projection !== null) ? request.projection : "PLATE_CARREE",
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/image/labels", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/image/labels", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_image_labels = function(table_name, x_column_name, y_column_name, x_offset, y_offset, text_string, font, text_color, text_angle, text_scale, draw_box, draw_leader, line_width, line_color, fill_color, leader_x_column_name, leader_y_column_name, filter, min_x, max_x, min_y, max_y, width, height, projection, options, callback) {
    var actual_request = {
        table_name: table_name,
        x_column_name: x_column_name,
        y_column_name: y_column_name,
        x_offset: (x_offset !== undefined && x_offset !== null) ? x_offset : "",
        y_offset: (y_offset !== undefined && y_offset !== null) ? y_offset : "",
        text_string: text_string,
        font: (font !== undefined && font !== null) ? font : "",
        text_color: (text_color !== undefined && text_color !== null) ? text_color : "",
        text_angle: (text_angle !== undefined && text_angle !== null) ? text_angle : "",
        text_scale: (text_scale !== undefined && text_scale !== null) ? text_scale : "",
        draw_box: (draw_box !== undefined && draw_box !== null) ? draw_box : "",
        draw_leader: (draw_leader !== undefined && draw_leader !== null) ? draw_leader : "",
        line_width: (line_width !== undefined && line_width !== null) ? line_width : "",
        line_color: (line_color !== undefined && line_color !== null) ? line_color : "",
        fill_color: (fill_color !== undefined && fill_color !== null) ? fill_color : "",
        leader_x_column_name: (leader_x_column_name !== undefined && leader_x_column_name !== null) ? leader_x_column_name : "",
        leader_y_column_name: (leader_y_column_name !== undefined && leader_y_column_name !== null) ? leader_y_column_name : "",
        filter: (filter !== undefined && filter !== null) ? filter : "",
        min_x: min_x,
        max_x: max_x,
        min_y: min_y,
        max_y: max_y,
        width: width,
        height: height,
        projection: (projection !== undefined && projection !== null) ? projection : "PLATE_CARREE",
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/image/labels", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/image/labels", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_isochrone_request = function(request, callback) {
    var actual_request = {
        graph_name: request.graph_name,
        source_node: request.source_node,
        max_solution_radius: (request.max_solution_radius !== undefined && request.max_solution_radius !== null) ? request.max_solution_radius : "-1.0",
        weights_on_edges: (request.weights_on_edges !== undefined && request.weights_on_edges !== null) ? request.weights_on_edges : [],
        restrictions: (request.restrictions !== undefined && request.restrictions !== null) ? request.restrictions : [],
        num_levels: (request.num_levels !== undefined && request.num_levels !== null) ? request.num_levels : "1",
        generate_image: (request.generate_image !== undefined && request.generate_image !== null) ? request.generate_image : true,
        levels_table: (request.levels_table !== undefined && request.levels_table !== null) ? request.levels_table : "",
        style_options: request.style_options,
        solve_options: (request.solve_options !== undefined && request.solve_options !== null) ? request.solve_options : {},
        contour_options: (request.contour_options !== undefined && request.contour_options !== null) ? request.contour_options : {},
        options: (request.options !== undefined && request.options !== null) ? request.options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/isochrone", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/isochrone", actual_request);
        return data;
    }
};
GPUdb.prototype.visualize_isochrone = function(graph_name, source_node, max_solution_radius, weights_on_edges, restrictions, num_levels, generate_image, levels_table, style_options, solve_options, contour_options, options, callback) {
    var actual_request = {
        graph_name: graph_name,
        source_node: source_node,
        max_solution_radius: (max_solution_radius !== undefined && max_solution_radius !== null) ? max_solution_radius : "-1.0",
        weights_on_edges: (weights_on_edges !== undefined && weights_on_edges !== null) ? weights_on_edges : [],
        restrictions: (restrictions !== undefined && restrictions !== null) ? restrictions : [],
        num_levels: (num_levels !== undefined && num_levels !== null) ? num_levels : "1",
        generate_image: (generate_image !== undefined && generate_image !== null) ? generate_image : true,
        levels_table: (levels_table !== undefined && levels_table !== null) ? levels_table : "",
        style_options: style_options,
        solve_options: (solve_options !== undefined && solve_options !== null) ? solve_options : {},
        contour_options: (contour_options !== undefined && contour_options !== null) ? contour_options : {},
        options: (options !== undefined && options !== null) ? options : {}
    };

    if (callback !== undefined && callback !== null) {
        this.submit_request("/visualize/isochrone", actual_request, callback);
    } else {
        var data = this.submit_request("/visualize/isochrone", actual_request);
        return data;
    }
};

export default GPUdb;
