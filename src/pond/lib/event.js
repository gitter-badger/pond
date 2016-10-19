/*
 *  Copyright (c) 2015, The Regents of the University of California,
 *  through Lawrence Berkeley National Laboratory (subject to receipt
 *  of any required approvals from the U.S. Dept. of Energy).
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree.
 */

import moment from "moment";
import _ from "underscore";
import Immutable from "immutable";

import IndexedEvent from "./indexedevent";
import TimeRangeEvent from "./timerangeevent";
import TimeRange from "./timerange";
import { sum, avg } from "./base/functions";
import util from "./base/util";


/**
There are three types of Events in Pond:

1. *Event* - a generic event which associates a timestamp with some data
2. *TimeRangeEvent* - associates a TimeRange with some data
3. *IndexedEvent* - associates a time range specified as an Index

### Construction

The creation of an Event is done by combining two parts: the timestamp (or time range, or Index...) and the data, along with an optional key which is described below.

 * For a basic `Event`, you specify the timestamp as either a Javascript Date object, a Moment, or the number of milliseconds since the UNIX epoch.

 * For a `TimeRangeEvent`, you specify a TimeRange, along with the data.

 * For a `IndexedEvent`, you specify an Index, along with the data, and if the event should be considered to be in UTC time or not.

To specify the data you can supply:

 * a Javascript object of key/values. The object may contained nested data.

 * an Immutable.Map

 * a simple type such as an integer. This is a shorthand for supplying {"value": v}.

**Example:**

Given some source of data that looks like this:

```json
const sampleEvent = {
    "start_time": "2015-04-22T03:30:00Z",
    "end_time": "2015-04-22T13:00:00Z",
    "description": "At 13:33 pacific circuit 06519 went down.",
    "title": "STAR-CR5 - Outage",
    "completed": true,
    "external_ticket": "",
    "esnet_ticket": "ESNET-20150421-013",
    "organization": "Internet2 / Level 3",
    "type": "U"
}
```

We first extract the begin and end times to build a TimeRange:

```js
let b = new Date(sampleEvent.start_time);
let e = new Date(sampleEvent.end_time);
let timerange = new TimeRange(b, e);
```

Then we combine the TimeRange and the event itself to create the Event.

```js
let outageEvent = new TimeRangeEvent(timerange, sampleEvent);
```

Once we have an event we can get access the time range with:

```js
outageEvent.begin().getTime()   // 1429673400000
outageEvent.end().getTime())    // 1429707600000
outageEvent.humanizeDuration()) // "10 hours"
```

And we can access the data like so:

```js
outageEvent.get("title")  // "STAR-CR5 - Outage"
```

Or use:

```js
outageEvent.data()
```

to fetch the whole data object, which will be an Immutable Map.
*/
class Event {

    /**
     * The creation of an Event is done by combining two parts:
     * the timestamp and the data.
     *
     * To construct you specify the timestamp as either:
     *     - Javascript Date object
     *     - a Moment, or
     *     - millisecond timestamp: the number of ms since the UNIX epoch
     *
     * To specify the data you can supply either:
     *     - a Javascript object containing key values pairs
     *     - an Immutable.Map, or
     *     - a simple type such as an integer. In the case of the simple type
     *       this is a shorthand for supplying {"value": v}.
     */
    constructor(arg1, arg2) {
        if (arg1 instanceof Event) {
            const other = arg1;
            this._d = other._d;
            return;
        }
        if (arg1 instanceof Immutable.Map &&
            arg1.has("time") && arg1.has("data")) {
            this._d = arg1;
            return;
        }
        const time = timestampFromArg(arg1);
        const data = dataFromArg(arg2);
        this._d = new Immutable.Map({time, data});
    }

    /**
     * Returns the Event as a JSON object, essentially:
     *  {time: t, data: {key: value, ...}}
     * @return {Object} The event as JSON.
     */
    toJSON() {
        return {
            time: this.timestamp().getTime(),
            data: this.data().toJSON()
        };
    }

    /**
     * Retruns the Event as a string, useful for serialization.
     * @return {string} The Event as a string
     */
    toString() {
        return JSON.stringify(this.toJSON());
    }

    /**
     * Returns a flat array starting with the timestamp, followed by the values.
     */
    toPoint() {
        return [this.timestamp().getTime(), ..._.values(this.data().toJSON())];
    }

    /**
     * The timestamp of this data, in UTC time, as a string.
     */
    timestampAsUTCString() {
        return this.timestamp().toUTCString();
    }

    /**
     * The timestamp of this data, in Local time, as a string.
     */
    timestampAsLocalString() {
        return this.timestamp().toString();
    }

    /**
     * The timestamp of this data
     */
    timestamp() {
        return this._d.get("time");
    }

    /**
     * The begin time of this Event, which will be just the timestamp
     */
    begin() {
        return this.timestamp();
    }

    /**
     * The end time of this Event, which will be just the timestamp
     */
    end() {
        return this.timestamp();
    }

    /**
     * Direct access to the event data. The result will be an Immutable.Map.
     */
    data() {
        return this._d.get("data");
    }

    /**
     * Sets the data portion of the event and returns a new Event.
     */
    setData(data) {
        const d = this._d.set("data", dataFromArg(data));
        return new Event(d);
    }

    /**
     * Get specific data out of the Event. The data will be converted
     * to a js object. You can use a fieldPath to address deep data.
     * @param  {Array}  fieldPath   Name of value to look up. If not provided,
     *                              defaults to ['value']. "Deep" syntax is
     *                              ['deep', 'value'] or 'deep.value.'
     * @return                      The value of the field
     */
    get(fieldPath) {
        let v;
        const fspec = util.fieldPathToArray(fieldPath);
        v = this.data().getIn(fspec);
        if (v instanceof Immutable.Map || v instanceof Immutable.List) {
            return v.toJS();
        }
        return v;
    }

    /**
     * Get specific data out of the Event. Alias for get(). The data will
     * be converted to a js object. You can use a fieldPath to address deep data.
     * @param  {Array}  fieldPath   Name of value to look up. If not provided,
     *                              defaults to ['value']. "Deep" syntax is
     *                              ['deep', 'value'] or 'deep.value.'
     * @return                      The value of the field
     */
    value(fieldSpec) {
        return this.get(fieldSpec);
    }

    /**
     * Turn the Collection data into a string
     * @return {string} The collection as a string
     */
    stringify() {
        return JSON.stringify(this.data());
    }

    /**
     * Collapses this event's columns, represented by the fieldSpecList
     * into a single column. The collapsing itself is done with the reducer
     * function. Optionally the collapsed column could be appended to the
     * existing columns, or replace them (the default).
     */
    collapse(fieldSpecList, name, reducer, append = false) {
        const data = append ? this.data().toJS() : {};
        const d = fieldSpecList.map(fs => this.get(fs));
        data[name] = reducer(d);
        return this.setData(data);
    }

    static is(event1, event2) {
        return Immutable.is(event1._d, event2._d);
    }

    /**
     * The same as Event.value() only it will return false if the
     * value is either undefined, NaN or Null.
     *
     * @param {Event} event The Event to check
     * @param {string|array} The field to check
     */
    static isValidValue(event, fieldPath) {
        const v = event.value(fieldPath);
        const invalid = (_.isUndefined(v) || _.isNaN(v) || _.isNull(v));
        return !invalid;
    }

    /**
     * Function to select specific fields of an event using
     * a fieldPath and return a new event with just those fields.
     *
     * The fieldPath currently can be:
     *  * A single field name
     *  * An array of field names
     *
     * The function returns a new event.
     */
    static selector(event, fieldPath) {
        const data = {};
        if (_.isString(fieldPath)) {
            const fieldName = fieldPath;
            const value = event.get(fieldName);
            data[fieldName] = value;
        } else if (_.isArray(fieldPath)) {
            _.each(fieldPath, fieldName => {
                const value = event.get(fieldName);
                data[fieldName] = value;
            });
        } else {
            return event;
        }
        return event.setData(data);
    }

    /**
     * Merges multiple `events` together into a new array of events, one
     * for each time/index/timerange of the source events. Merging is done on
     * the data of each event. Values from later events in the list overwrite
     * early values if fields conflict, but generally you can use this in two
     * common use cases:
     *   - append events of different timestamps
     *   - merge in events with one field to events with another
     *
     * See also: TimeSeries.timeSeriesListMerge()
     *
     * @param {array}        events     Array of event objects
     */
    static merge(events) {
        if (events.length === 0) {
            return [];
        }

        const eventMap = {};
        const typeMap = {};

        //
        // Group by the time (the key), as well as keeping track
        // of the event types so we can check that for a given key
        // they are homogeneous and also so we can build an output
        // event for this key
        //

        events.forEach(e => {

            let type;
            let key;
            if (e instanceof Event) {
                type = Event;
                key = e.timestamp().getTime();
            } else if (e instanceof IndexedEvent) {
                type = IndexedEvent;
                key = e.index();
            } else if (e instanceof TimeRangeEvent) {
                type = TimeRangeEvent;
                key = `${e.timerange().begin()},${e.timerange().end()}`;
            }

            if (!_.has(eventMap, key)) {
                eventMap[key] = [];
            }
            eventMap[key].push(e);

            if (!_.has(typeMap, key)) {
                typeMap[key] = type;
            } else {
                if (typeMap[key] !== type) {
                    throw new Error(`Events for time ${key} are not homogeneous`)
                }
            }
        });

        //
        // For each key we'll build a new event of the same type as the source
        // events. Here we loop through all the events for that key, then for each field
        // we are considering, we get all the values and reduce them (sum, avg, etc).
        //

        const outEvents = [];
        _.each(eventMap, (events, key) => {
            let data = Immutable.Map();
            events.forEach(event => {
                data = data.merge(event.data());
            });

            const type = typeMap[key];
            if (type === Event) {
                const timestamp = +key;
                outEvents.push(new Event(timestamp, data));
            } else if (type === IndexedEvent) {
                const index = key;
                outEvents.push(new IndexedEvent(index, data));
            } else if (type === TimeRangeEvent) {
                const [ begin, end ] = key.split(",");
                const timerange = new TimeRange(+begin, +end);
                outEvents.push(new TimeRangeEvent(timerange, data));
            }
        });

        return outEvents;
    }

    /**
     * Combines multiple `events` together into a new array of events, one
     * for each time/index/timerange of the source events. Combining acts
     * on the fields specified in the `fieldSpec` and uses the reducer to
     * take the multiple values and reducer them down to one. A reducer is
     * any of the standard Pond functions: avg(), sum() etc.
     *
     * See also: TimeSeries.timeSeriesListSum()
     *
     * @param {array}        events     Array of event objects
     * @param {string|array} fieldSpec  Column or columns to look up. If you need
     *                                  to retrieve multiple deep nested values that
     *                                  ['can.be', 'done.with', 'this.notation'].
     *                                  A single deep value with a string.like.this.
     *                                  If not supplied, all columns will be operated on.
     * @param {function}     reducer    Reducer function to apply to column data.
     */
    static combine(events, fieldSpec, reducer) {
        if (events.length === 0) {
            return [];
        }

        let fieldNames;
        if (_.isString(fieldSpec)) {
            fieldNames = [fieldSpec];
        } else if (_.isArray(fieldSpec)) {
            fieldNames = fieldSpec;
        }

        const eventMap = {};
        const typeMap = {};

        //
        // Group by the time (the key), as well as keeping track
        // of the event types so we can check that for a given key
        // they are homogeneous and also so we can build an output
        // event for this key
        //

        events.forEach(e => {

            let type;
            let key;
            if (e instanceof Event) {
                type = Event;
                key = e.timestamp().getTime();
            } else if (e instanceof IndexedEvent) {
                type = IndexedEvent;
                key = e.index();
            } else if (e instanceof TimeRangeEvent) {
                type = TimeRangeEvent;
                key = `${e.timerange().begin()},${e.timerange().end()}`;
            }

            if (!_.has(eventMap, key)) {
                eventMap[key] = [];
            }
            eventMap[key].push(e);

            if (!_.has(typeMap, key)) {
                typeMap[key] = type;
            } else {
                if (typeMap[key] !== type) {
                    throw new Error(`Events for time ${key} are not homogeneous`)
                }
            }
        });

        //
        // For each key we'll build a new event of the same type as the source
        // events. Here we loop through all the events for that key, then for each field
        // we are considering, we get all the values and reduce them (sum, avg, etc).
        //

        const outEvents = []
        _.each(eventMap, (events, key) => {
            const mapEvent = {};
            events.forEach(event => {
                let fields = fieldNames;
                if (!fieldNames) {
                     fields = _.map(event.data().toJSON(), (value, fieldName) => fieldName);
                }
                fields.forEach(fieldName => {
                    if (!mapEvent[fieldName]) {
                        mapEvent[fieldName] = [];
                    }
                    mapEvent[fieldName].push(event.data().get(fieldName));
                });
            });

            const d = {};
            _.map(mapEvent, (values, fieldName) => {
                d[fieldName] = reducer(values);
            });

            const type = typeMap[key];
            if (type === Event) {
                const timestamp = +key;
                outEvents.push(new Event(timestamp, d));
            } else if (type === IndexedEvent) {
                const index = key;
                outEvents.push(new IndexedEvent(index, d));
            } else if (type === TimeRangeEvent) {
                const [ begin, end ] = key.split(",");
                const timerange = new TimeRange(+begin, +end);
                outEvents.push(new TimeRangeEvent(timerange, d));
            }

        });

        return outEvents;
    }

    /**
     * Sum takes multiple events and sums them together. The result is a
     * single event for each timestamp. Events should be homogeneous.
     *
     * @param {array}        events     Array of event objects
     * @param {string|array} fieldSpec  Column or columns to look up. If you need
     *                                  to retrieve multiple deep nested values that
     *                                  ['can.be', 'done.with', 'this.notation'].
     *                                  A single deep value with a string.like.this.
     *                                  If not supplied, all columns will be operated on.
     */
    static sum(events, fieldSpec) {
        return Event.combine(events, fieldSpec, sum());
    }

    /**
     * Sum takes multiple events, groups them by timestamp, and uses combine()
     * to average them. If the events do not have the same timestamp an
     * exception will be thrown.
     *
     * @param {array}        events     Array of event objects
     * @param {string|array} fieldSpec  Column or columns to look up. If you need
     *                                  to retrieve multiple deep nested values that
     *                                  ['can.be', 'done.with', 'this.notation'].
     *                                  A single deep value with a string.like.this.
     *                                  If not supplied, all columns will be operated on.
     */
    static avg(events, fieldSpec) {
        return Event.combine(events, fieldSpec, avg());
    }

    /**
     * Maps a list of events according to the fieldSpec
     * passed in. The spec maybe a single field name, a
     * list of field names, or a function that takes an
     * event and returns a key/value pair.
     *
     * @example
     * ````
     *         in   out
     *  3am    1    2
     *  4am    3    4
     *
     * Mapper result:  { in: [1, 3], out: [2, 4]}
     * ```
     * @param {string|array} fieldSpec  Column or columns to look up. If you need
     *                                  to retrieve multiple deep nested values that
     *                                  ['can.be', 'done.with', 'this.notation'].
     *                                  A single deep value with a string.like.this.
     *                                  If not supplied, all columns will be operated on.
     *                                  If field_spec is a function, the function should
     *                                  return a map. The keys will be come the
     *                                  "column names" that will be used in the map that
     *                                  is returned.
     */
    static map(evts, multiFieldSpec = "value") {
        const result = {};

        let events;
        if (evts instanceof Immutable.List) {
            events = evts;
        } else if (_.isArray(evts)) {
            events = new Immutable.List(evts);
        } else {
            throw new Error("Unknown event list type. Should be an array or Immutable List");
        }

        if (_.isString(multiFieldSpec)) {
            const fieldSpec = multiFieldSpec;
            events.forEach(event => {
                if (!_.has(result, fieldSpec)) {
                    result[fieldSpec] = [];
                }
                const value = event.get(fieldSpec);
                
                result[fieldSpec].push(value);
            });
        } else if (_.isArray(multiFieldSpec)) {
            _.each(multiFieldSpec, fieldSpec => {
                events.forEach(event => {

                    if (!_.has(result, fieldSpec)) {
                        result[fieldSpec] = [];
                    }
                    result[fieldSpec].push(event.get(fieldSpec));
                });
            });
        } else if (_.isFunction(multiFieldSpec)) {
            events.forEach(event => {
                const pair = multiFieldSpec(event);
                _.each(pair, (value, key) => {
                    if (!_.has(result, key)) {
                        result[key] = [];
                    }
                    result[key].push(value);
                });
            });
        } else {
            events.forEach(event => {
                _.each(event.data().toJSON(), (value, key) => {
                    if (!_.has(result, key)) {
                        result[key] = [];
                    }
                    result[key].push(value);
                });
            });
        }
        return result;
    }

    /**
     * Takes a list of events and a reducer function and returns
     * a new Event with the result, for each column. The reducer is
     * of the form:
     * ```
     *     function sum(valueList) {
     *         return calcValue;
     *     }
     * ```
     * @param {map}         mapped      A map, as produced from map()
     * @param {function}    reducer     The reducer function
     */
    static reduce(mapped, reducer) {
        const result = {};
        _.each(mapped, (valueList, key) => {
            result[key] = reducer(valueList);
        });
        return result;
    }
    /*
     * @param {array}        events     Array of event objects
     * @param {string|array} fieldSpec  Column or columns to look up. If you need
     *                                  to retrieve multiple deep nested values that
     *                                  ['can.be', 'done.with', 'this.notation'].
     *                                  A single deep value with a string.like.this.
     *                                  If not supplied, all columns will be operated on.
     * @param {function}     reducer    The reducer function
     */
    static mapReduce(events, multiFieldSpec, reducer) {
        return Event.reduce(this.map(events, multiFieldSpec), reducer);
    }
}

function timestampFromArg(arg) {
    if (_.isNumber(arg)) {
        return new Date(arg);
    } else if (_.isDate(arg)) {
        return new Date(arg.getTime());
    } else if (moment.isMoment(arg)) {
        return new Date(arg.valueOf());
    } else {
        throw new Error(`Unable to get timestamp from ${arg}. Should be a number, date, or moment.`);
    }
}

function dataFromArg(arg) {
    let data;
    if (_.isObject(arg)) {
        // Deeply convert the data to Immutable Map
        data = new Immutable.fromJS(arg);
    } else if (data instanceof Immutable.Map) {
        // Copy reference to the data
        data = arg;
    } else if (_.isNumber(arg) || _.isString(arg)) {
        // Just add it to the value key of a new Map
        // e.g. new Event(t, 25); -> t, {value: 25}
        data = new Immutable.Map({value: arg});
    } else {
        throw new Error(`Unable to interpret event data from ${arg}.`);
    }
    return data;
}

export default Event;
