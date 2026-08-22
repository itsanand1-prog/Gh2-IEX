#!/usr/bin/env node
'use strict';
/* Single entry point: loads every *.test.js in this directory (each just
 * registers describe()/test() blocks) then runs the combined suite once. */
require('./model.test.js');
require('./charges.test.js');
require('./hash.test.js');
require('./fuzz.test.js');
require('./framework.js').run();
