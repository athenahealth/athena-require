var root = this;

QUnit.config.autostart = true;

QUnit.test('simple module, synchronous require', function(assert) { "use strict";
  assert.expect(6);

  var count = 0;
  define('0-a', function() {
    ++count;
    assert.strictEqual(this, root, "this of factory function is root context's this");

    return { foo: 'bar' };
  });

  assert.strictEqual(count, 0, 'factory function not run before the first require');

  var m = require('0-a');

  assert.deepEqual(m, { foo: 'bar' }, 'correct value is returned');
  assert.strictEqual(require('0-a'), m, 'strictly the same value is always returned for a module');
  assert.strictEqual(count, 1, 'factory function does not run more than once');

  assert.raises(function() {
    require('0-bogus');
  }, /Module 0-bogus or one of its dependencies is not (yet )?defined./, 'undefined module throws an error');
});

QUnit.test('simple module, asynchronous require', function(assert) { "use strict";
  var ready = assert.async();

  assert.expect(9);

  var count = 0;
  define('1-0', function() {
    ++count;
    return { foo: 'bar' };
  });

  define('1-1', function() {
    return { biz: 'baz' };
  });

  define('1-2', function() {
    return { wiz: 'waz' };
  });

  assert.strictEqual(count, 0, 'factory function not run before the first require');

  var m1;
  var m2;
  var m3;
  var m4;
  require([
    '1-0'
  ], function(
    dep0
  ) {
    assert.strictEqual(this, root, "this of require callback function is root context's this");
    assert.deepEqual(dep0, { foo: 'bar' }, 'correct value is passed to callback');
    m1 = dep0;
  });

  require([
    '1-0'
  ], function(
    dep0
  ) {
    assert.strictEqual(dep0, m1, 'strictly the same value is always given for a module');
    m2 = dep0;
  });

  require(['1-1', '1-2'], function(dep0, dep1) {
    assert.deepEqual(dep0, { biz: 'baz' }, 'can require more than one module');
    m3 = dep0;
  });

  require(['1-0', '1-2'], function(dep0, dep1) {
    assert.strictEqual(dep0, m1, 'strictly the same value is always given more a module when multiple modules are required');
    m4 = dep1;
  });

  require(['1-0', '1-1', '1-2'], function(dep0, dep1) {
    assert.strictEqual(count, 1, 'factory function does not run more than once');
    assert.ok(m1 && m2 && m3 && m4, 'when plugins are not involved, require callbacks are executed in order.');

    ready();
  });

  assert.strictEqual(count, 0, '3-argument call of require defers, and current execution stack continues');
});

QUnit.test('define order', function(assert) { "use strict";
  assert.expect(2);

  define('2-a', [
    '2-b'
  ], function(
    dep
  ) {
    return dep;
  });

  define('2-b', function() {
    return '2-b';
  });

  assert.strictEqual(require('2-a'), '2-b', 'depended-on module can be defined after depending module');

  define('2-c', function() {
    return '2-c';
  });

  define('2-d', [
    '2-c'
  ], function(
    dep
  ) {
    return dep;
  });

  assert.strictEqual(require('2-d'), '2-c', 'depended-on module can be defined before depending module');

});

QUnit.test('relative paths', function(assert) { "use strict";
  assert.expect(8);

  var counts0 = {
    "3-a/b/d" : 0,
    "3-a/e"   : 0,
    "3-f/g/d" : 0,
    "3-f/e"   : 0
  };

  define('3-a/b/c', [
    './d',
    '../e'
  ], function(
    dep0,
    dep1
  ) {
    assert.strictEqual(dep0, '3-a/b/d', 'relative to current path');
    assert.strictEqual(dep1, '3-a/e', 'relative to parent path');

    return '3-a/b/c';
  });

  define('3-a/b/d', function() {
    ++counts0['3-a/b/d'];
    return '3-a/b/d';
  });

  define('3-a/e', function() {
    ++counts0['3-a/e'];
    return '3-a/e';
  });

  require('3-a/b/c');

  define('3-f/g/h', [
    './d',
    '../e'
  ], function(
    dep0,
    dep1
  ) {
    assert.strictEqual(dep0, '3-f/g/d', "dependency string relative to current module's path, which looks the same as a previous dependency string, points to correct module");
    assert.strictEqual(dep1, '3-f/e', "dependency string relative to parent of the current module's path, which looks the same as a previous dependency string, points to correct module");
  });

  define('3-f/g/d', function() {
    ++counts0['3-f/g/d'];
    return '3-f/g/d';
  });

  define('3-f/e', function() {
    ++counts0['3-f/e'];
    return '3-f/e';
  });

  require('3-f/g/h');

  assert.deepEqual(
    counts0,
    {
      "3-a/b/d" : 1,
      "3-a/e"   : 1,
      "3-f/g/d" : 1,
      "3-f/e"   : 1
    },
    "when a dependency string that is a relative path occurs more than once, but the current module is different in each instance, the dependency modules' factory functions should be run exactly once each"
  );

  define('3-a/b/i', [
    './d',
    '../e'
  ], function() {
    return '3-a/b/i';
  });

  require('3-a/b/i');

  assert.deepEqual(
    counts0,
    {
      "3-a/b/d" : 1,
      "3-a/e"   : 1,
      "3-f/g/d" : 1,
      "3-f/e"   : 1
    },
    "when a dependency string that is a relative path refers to a module whose factory function has already run, the factory function should not be run again"
  );

  define('3-j', [
    '3-a/b/d',
    '3-a/e'
  ], function() {
    return '3-j';
  });

  require('3-j');

  assert.deepEqual(
    counts0,
    {
      "3-a/b/d" : 1,
      "3-a/e"   : 1,
      "3-f/g/d" : 1,
      "3-f/e"   : 1
    },
    "when a dependency string that is an absolute path refers to a module whose factory function has already run because of a dependency refered to by a relative path, the factory function should not be run again"
  );

  /***********/

  var counts1 = {
    "3-j/k/d" : 0,
    "3-j/e"   : 0
  };

  define('3-j/k/l', [
    '3-j/k/d',
    '3-j/e'
  ], function() {
    return '3-j/k/l';
  });

  define('3-j/k/d', function() {
    ++counts1['3-j/k/d'];
    return '3-j/k/d';
  });

  define('3-j/e', function() {
    ++counts1['3-j/e'];
    return '3-j/e';
  });

  require('3-j/k/l');

  define('3-j/k/m', [
    './d',
    '../e'
  ], function() {
    return '3-j/k/m';
  });

  require('3-j/k/m');

  assert.deepEqual(
    counts1,
    {
      "3-j/k/d" : 1,
      "3-j/e"   : 1
    },
    "when a dependency string that is a relative path refers to a module whose factory function has already run because of a dependency refered to by an absolute path, the factory function should not be run again"
  );

});

QUnit.test('plugins', function(assert) { "use strict";
  assert.expect(28);

  assert.raises(function() {
    require('4-plugin-bogus!z');
  }, /4-plugin-bogus or one of its dependencies is not (yet )?defined./, 'undefined plugin throws an error');

  var count0 = 0;

  define('4-plugin-0', function() {
    return {
      load: function(name, req, onLoad, config) {
        ++count0;
        assert.strictEqual(name, '4-a/b', 'module name passed into plugin correctly');
        assert.strictEqual(req, require, 'require is passed into plugin');
        assert.strictEqual(config, req.config(), 'configuration is passed into load');
        onLoad({ name: name, pluginApplied: true });
      }
    };
  });

  define('4-a/b', function() {
    return {};
  });

  var plugin0OnAB = require('4-plugin-0!4-a/b');

  assert.deepEqual(plugin0OnAB, { name: '4-a/b', pluginApplied: true }, 'plugin applied correctly');
  assert.strictEqual(require('4-plugin-0!4-a/b'), plugin0OnAB, 'identical plugin invocation returns strictly the same value');
  assert.strictEqual(count0, 1, 'identical plugin invocation does not run load function again');

  define('4-a/c', [
    '4-plugin-0!./b'
  ], function(
    dep0
  ) {
    assert.strictEqual(dep0, plugin0OnAB, "when plugin invocation's target is a relative path to a module where the plugin has already been invoked on that module by absolute, returns strictly the same value");
    assert.deepEqual(count0, 1, "when plugin invocation's target is a relative path to a module where the plugin has already been invoked on that module, load function is not run again");

    return '4-a/c';
  });

  require('4-a/c');

  /**********/

  var count1 = 0;
  define('4-plugin-1', function() {
    return {
      load: function(name, req, onLoad) {
        ++count1;
        onLoad({ name: name, pluginApplied: true });
      }
    };
  });

  define('4-d/e', [
    '4-plugin-1!./f'
  ], function(
    dep0
  ) {
    return dep0;
  });

  var plugin1OnDF = require('4-d/e');

  assert.strictEqual(count1, 1, "when plugin invocation's target is an absolute path to a module where the plugin has already been invoked on that module by relative path, load function is not run again");
  assert.strictEqual(require('4-plugin-1!4-d/f'), plugin1OnDF, "when plugin invocation's target is an absolute path to a module where the plugin has already been invoked on that module by relative path, returns strictly the same value");

  /**********/

  var count2 = 0;
  var count2Normalize = 0;
  var plugin2Arg;
  define('4-plugin-2', function() {
    return {
      normalize: function(name, normalize) {
        ++count2Normalize;
        assert.strictEqual(name, plugin2Arg, 'module name ' + plugin2Arg + ' currently passed through to normalize');

        var normalized = normalize(name);
        assert.strictEqual(normalized, '4-g/i', plugin2Arg + ' correctly normalizes');
        return normalized + '-foo';
      },
      load: function(name, req, onLoad) {
        ++count2;
        assert.strictEqual(name, '4-g/i-foo', 'result of custom normalize function passed to load function');
        onLoad(name);
      }
    };
  });

  plugin2Arg = '4-g/i';
  require('4-plugin-2!4-g/i');

  plugin2Arg = './i';
  define('4-g/h', [
    '4-plugin-2!./i'
  ], function() {
    return {};
  });

  require('4-g/h');

  assert.strictEqual(count2Normalize, 2, 'normalize is run on each invocation');
  assert.strictEqual(count2, 1, 'when the args of different invocations of a plugin normalize to same module, the load function is only run once');

  /**********/

  var count3 = 0;
  var count3Plugin = 0;

  define('4-a/b/plugin-3', function() {
    ++count3Plugin;
    return {
      load: function(name, req, onLoad) {
        ++count3;
        onLoad(name);
      }
    };
  });

  define('4-a/b/b', [
    './plugin-3!4-a/b/d'
  ], function() {
    return {};
  });

  require('4-a/b/b');
  require('4-a/b/plugin-3!4-a/b/d');

  assert.strictEqual(count3Plugin, 1, 'when a plugin is applied to a module twice, the first time the plugin being referenced by relative path and the second time by absolute path, the factory function for the plugin is only run once');
  assert.strictEqual(count3, 1, 'when a plugin is applied to a module twice, the first time the plugin being referenced by relative path and the second time by absolute path, the load function is only run once.');

  require('4-a/b/plugin-3!4-a/b/e');

  assert.strictEqual(count3Plugin, 1, 'when a plugin is referenced by relative path, and then by absolute path, and the target is different, the factory function for the plugin should not be run again.');
  assert.strictEqual(count3, 2, 'when a plugin is referenced by relative path, and then by absolute path, and the target is different, the load function should be run again.');

  var count4 = 0;
  var count4Plugin = 0;

  define('4-a/b/plugin-4', function() {
    ++count4Plugin;
    return {
      load: function(name, req, onLoad) {
        ++count4;
        onLoad(name);
      }
    };
  });

  define('4-a/b/c', [
    './plugin-4!4-a/b/d'
  ], function() {
    return {};
  });

  require('4-a/b/plugin-4!4-a/b/d');
  require('4-a/b/c');

  assert.strictEqual(count4Plugin, 1, 'when a plugin is applied to a module twice, the first time the plugin being referenced by absolute path and the second time by relative path, the factory function for the plugin is only run once');
  assert.strictEqual(count4, 1, 'when a plugin is applied to a module twice, the first time the plugin being referenced by absolute path and the second time by relative path, the load function is only run once.');

  define('4-a/b/f', [
    './plugin-4!4-a/b/g'
  ], function() {
    return {};
  });

  require('4-a/b/f');

  assert.strictEqual(count4Plugin, 1, 'when a plugin is referenced by absolute path, and then by relative path, and the target is different, the factory function for the plugin should not be run again.');
  assert.strictEqual(count4, 2, 'when a plugin is referenced by absolute path, and then by relative path, and the target is different, the load function should be run again.');

  /**********/

  var ready = assert.async();

  define('4-s', [
    '4-plugin-5!4-t',
    '4-u'
  ], function(
    dep0,
    dep1
  ) {
    return dep0.processed + ':' + dep1;
  });

  define('4-t', function() {
    return { name: '4-t' };
  });

  define('4-u', [
    '4-plugin-5!4-v'
  ], function(
    dep0
  ) {
    return dep0.processed;
  });

  define('4-v', function() {
    return { name: '4-v' };
  });

  define('4-plugin-5', function() {
    return {
      load: function(name, req, onLoad) {
        req([name], function(mod) {
          onLoad({ processed: mod.name + '-barbar' });
        });
      }
    };
  });

  require(['4-s'], function(result) {
    assert.strictEqual(result, '4-t-barbar:4-v-barbar', 'asynchronous plugin');

    ready();
  });

  /*********/

  define('4-w', [
    '4-plugin-6!4-x',
    '4-y'
  ], function(
    dep0,
    dep1
  ) {
    return dep0.processed + ':' + dep1;
  });

  define('4-x', function() {
    return { name: '4-x' };
  });

  define('4-y', [
    '4-plugin-6!4-z'
  ], function(
    dep0
  ) {
    return dep0.processed;
  });

  define('4-z', function() {
    return { name: '4-z' };
  });

  define('4-plugin-6', function() {
    return {
      load: function(name, req, onLoad) {
        req([name], function(mod) {
          onLoad({ processed: mod.name + '-barbar' });
        });
      }
    };
  });

  assert.raises(function() {
    require('4-w');
  }, /4-plugin-6!4-x is not yet ready/, 'bar');

});

QUnit.test('require, module and exports', function(assert) {
  assert.expect(22);

  define('5-a/b/c', [
    '5-a/b/d',
    './e',
    '../f'
  ], function(
    dep0,
    dep1,
    dep2
  ) {
    assert.deepEqual(dep1, { exportedByModule: 'fooE' }, 'module.exports is used when specified and module returns undefined');
    assert.deepEqual(dep2, { correctReturn: 'fooF' }, 'module.exports is not used if module returns a value');
    return {};
  });

  define('5-a/b/d', [
    'require',
    'module',
    'exports'
  ], function(
    req,
    module,
    exports
  ) {
    assert.strictEqual(req, require, "'require' is injectable as a dependency");
    assert.deepEqual(module, { id: '5-a/b/d', exports: {} }, 'module is in the correct format');
    assert.strictEqual(module.exports, exports, 'module.exports and exports refer to the same object');
  });

  define('5-a/b/e', [
    'module'
  ], function(
    module
  ) {
    assert.strictEqual(module.id, '5-a/b/e', 'module.id is the full module path even if it is refered to by a relative-to-current-module path');
    module.exports.exportedByModule = 'fooE';
  });

  define('5-a/f', [
    'module'
  ], function(
    module
  ) {
    assert.strictEqual(module.id, '5-a/f', 'module.id is the full module path even if it is refered to by a relative-to-parent path');
    module.exports.shouldNotBeExportByModule = 'fooF';
    return { correctReturn: 'fooF' };
  });

  require('5-a/b/c');

  /**********/

  define('5-g', [
    'exports'
  ], function(
    exports
  ) {
    exports.exportsForG = 'g';
  });

  assert.deepEqual(require('5-g'), { exportsForG: 'g' }, 'exports is used when specified and the module returns undefined');

  define('5-h', [
    'exports'
  ], function(
    exports
  ) {
    exports.shouldNotBeExported = 'h';
    return { correctValue: 'correctValue' };
  });

  assert.deepEqual(require('5-h'), { correctValue: 'correctValue' }, 'if there is a returned value, it is used instead of exports');

  define('5-i', function() {
    return undefined;
  });

  assert.ok((typeof require('5-i')) === 'undefined', 'if returned value is undefined, module is undefined');

  /**********/

  define('5-j', [
    'exports'
  ], function(
    exports
  ) {});

  define('5-k', [
    'exports'
  ], function(
    exports
  ) {});

  var result5J1 = require('5-j');
  var result5J2 = require('5-j');
  var result5K = require('5-k');

  assert.strictEqual(result5J2, result5J1, 'module which uses exports always returns reference to the same object');
  assert.notStrictEqual(result5K, result5J1, 'different modules which use exports return references to different objects');

  define('5-l', [
    'module'
  ], function(
    module
  ) {});

  define('5-m', [
    'module'
  ], function(
    module
  ) {});

  var result5L1 = require('5-l');
  var result5L2 = require('5-l');
  var result5M = require('5-m');

  assert.strictEqual(result5L2, result5L1, 'module which uses module (module.exports) always returns reference to the same object');
  assert.notStrictEqual(result5M, result5L1, 'different modules which use module (module.exports) return references to different objects');

  /**********/

  var fnN = function() { return 'n'; };
  define('5-n', [
    'module'
  ], function(
    module
  ) {
    module.exports =  fnN;
  });

  assert.strictEqual(require('5-n'), fnN, 'module.exports can be wholly assigned to a value');

  var fnO = function() { return 'o'; };
  define('5-o', [
    'module',
    'exports'
  ], function(
    module,
    exports
  ) {
    module.exports = fnO;
    exports.shouldNotBeExported = 'fooO';
  });

  assert.strictEqual(require('5-o'), fnO, 'reassigned module.exports is used, even if exports is modified')

  var fnP = function() { return 'p'; };

  define('5-p', [
    'module'
  ], function(
    module
  ) {
    module.exports =  fnP;
    return { correctReturn: true };
  });

  assert.deepEqual(require('5-p'), { correctReturn: true }, 'if module returns a value, reassigned module.exports is not used');

  /*******/

  define('5-r', [
    'module'
  ], function(
    module
  ) {
    module.exports.shouldNotBeExported = 'badValue';
    return false;
  });

  assert.strictEqual(require('5-r'), false, 'if module returns strictly false, module is strictly false, even if module.exports is used');

  define('5-s', [
    'exports'
  ], function(
    exports
  ) {
    exports.shouldNotBeExported = 'badValue';
    return false;
  });

  assert.strictEqual(require('5-s'), false, 'if module returns strictly false, module is strictly false, even if exports is used');

  define('5-t', [
    'module'
  ], function(
    module
  ) {
    module.exports = 'badValue';
    return false;
  });

  assert.strictEqual(require('5-t'), false, 'if module returns strictly false, module is strictly false, even if module.exports is used and reassigned');

  define('5-u', [
    'module'
  ], function() {});

  assert.deepEqual(require('5-u'), {}, 'when module is used but module.exports is untouched, module is {}');

  define('5-v', [
    'exports'
  ], function() {});

  assert.deepEqual(require('5-v'), {}, 'when exports is used, but is untouched, module is {}');
});

QUnit.test('require.ready()', function(assert) { "use strict";
  assert.expect(2);

  var modCount = 0;
  var count = 0;

  define('6-a', function() {
    ++modCount;
    return {};
  });

  require(['6-a'], function() {
   ++count;
  });

  require.ready();

  assert.strictEqual(modCount, 1, 'require.ready() immediately causes module resolution');
  assert.strictEqual(count, 1, 'require.ready() immediately causes callbacks to be executed');

});

QUnit.test('define', function(assert) { "use strict";
  assert.expect(6);

  assert.deepEqual(define.amd, { athena: true }, 'define.amd');

  define('7-a', function() {
    assert.notOk(arguments.length, '2-argument define');
    return {};
  });

  require('7-a');

  define('7-b', [], function() {
    assert.notOk(arguments.length, '3-argument define, no dependencies');
    return {};
  });

  require('7-b');

  define('7-c', [
    '7-d',
    '7-e'
  ], function() {
    assert.strictEqual(arguments.length, 2, '3-argument define with dependencies');
    return {};
  });

  define('7-d', function() {
    return {};
  });

  define('7-e', function() {
    return {};
  });

  require('7-c');

  var value = {};
  define('7-f', [
    '7-g'
  ], value);

  define('7-g', function() {
    assert.ok(true, 'dependency factory function is run even when depending module has a predefined value');
    return '';
  });

  assert.strictEqual(require('7-f'), value, 'define with predefined value instead of factory function');

});

QUnit.test('module timings', function(assert) { "use strict";
  assert.expect(3);

  require.config({ moduleTimingThreshold: 0.0 });

  define('8-a', function() {
    for (var i = 0; i < 10000000; ++i) {}

    return {};
  });

  require('8-a');

  var timings = require.getTimes();
  var totalModuleTime = timings.totalModuleTime;
  var totalNumberOfModules = timings.totalNumberOfModules;
  var ordering = timings.modules['8-a'].ordering;
  var time = timings.modules['8-a'].time;

  assert.ok(totalModuleTime && totalNumberOfModules && ordering && time, 'timings are recorded');

  define('8-b', function() {
    for (var i = 0; i < 10000000; ++i) {}

    return {};
  });

  var stoppedTimings = require.stopTimer();
  assert.strictEqual(timings, stoppedTimings, 'require.stopTimer() returns the timings object');

  require('8-b');

  timings = require.getTimes();
  assert.ok(
    timings.totalModuleTime === totalModuleTime && timings.totalNumberOfModules === totalNumberOfModules && !timings.modules['8-b'],
    'require.stopTimer() stops the module timer'
  );

});

QUnit.test('dependency tree', function(assert) { "use strict";
  assert.expect(2);

  var counts = {};

  define('9-a/i', function() {
    counts['9-a/i'] = counts['9-a/i']  || 0;
    ++counts['9-a/i'];
    return '9-a/i';
  });

  require('9-a/i'); // resolve this module for later use

  define('9-a/j', [
    '9-a/k'
  ], function() {
    counts['9-a/j'] = counts['9-a/j']  || 0;
    ++counts['9-a/j'];
    return Array.prototype.join.call(arguments,':');
  });

  define('9-a/k', function() {
    counts['9-a/k'] = counts['9-a/k']  || 0;
    ++counts['9-a/k'];
    return '9-a/k';
  });

  require('9-a/j'); // resolve this module for later use

  define('9-a/b', [
    '9-a/c', // has identical dependencies as 9-a/d, expressed differently
    '9-a/d', // has identical dependencies as 9-a/c, expressed differently, so shouldn't have to traverse this dependency sub-tree
    '9-a/e',
    '9-a/f'  // all its dependencies are already resolved, so should not have to traverse down
  ], function() {
    counts['9-a/b'] = counts['9-a/b']  || 0;
    ++counts['9-a/b'];
    return Array.prototype.join.call(arguments,':');
  });

  // has identical dependencies as 9-a/d, expressed differently
  define('9-a/c', [
    './g',
    '9-a/h'
  ], function() {
    counts['9-a/c'] = counts['9-a/c']  || 0;
    ++counts['9-a/c'];
    return Array.prototype.join.call(arguments,':');
  });

  // has identical dependencies as 9-a/c, expressed differently
  define('9-a/d', [
    '9-a/g',
    './h'
  ], function() {
    counts['9-a/d'] = counts['9-a/d']  || 0;
    ++counts['9-a/d'];
    return Array.prototype.join.call(arguments,':');
  });

  define('9-a/e', function() {
    counts['9-a/e'] = counts['9-a/e']  || 0;
    ++counts['9-a/e'];
    return '9-a/e';
  });

  // all its dependencies are already resolved, so should not have to traverse down
  define('9-a/f', [
    '9-a/i',
    'module',
    '9-a/j',
    'exports'
  ], function(
    dep0,
    dep1,
    dep2,
    dep3
  ) {
    counts['9-a/f'] = counts['9-a/f']  || 0;
    ++counts['9-a/f'];
    return dep0 + ':' + dep2;
  });

  define('9-a/g', function() {
    counts['9-a/g'] = counts['9-a/g']  || 0;
    ++counts['9-a/g'];
    return '9-a/g';
  });

  define('9-a/h', function() {
    counts['9-a/h'] = counts['9-a/h']  || 0;
    ++counts['9-a/h'];
    return '9-a/h';
  });

  assert.strictEqual(require('9-a/b'), '9-a/g:9-a/h:9-a/g:9-a/h:9-a/e:9-a/i:9-a/k', 'dependency tree is traversed and values returned');
  assert.deepEqual(counts, {
    "9-a/b" : 1,
    "9-a/c" : 1,
    "9-a/d" : 1,
    "9-a/e" : 1,
    "9-a/f" : 1,
    "9-a/g" : 1,
    "9-a/h" : 1,
    "9-a/i" : 1,
    "9-a/j" : 1,
    "9-a/k" : 1
  }, 'all factory functions only executed once');

});

QUnit.test('dependency loops', function(assert) {
  assert.expect(2);

  define('10-a', ['10-b'], function() { return {}; });
  define('10-b', ['10-c'], function() { return {}; });
  define('10-c', ['10-a'], function() { return {}; });

  assert.raises(function(){
    require('10-a');
  }, /Traversed too many nodes in the dependency tree. Possible cycle at module .+ or at a related module\./, 'dependency loop throws error');

  define('10-d', function() { return {}; });
  define('10-e', ['10-d', '10-f'], function() { return {}; });
  define('10-f', ['10-g'], function() { return {}; });
  define('10-g', ['10-e'], function() { return {}; });

  assert.raises(function(){
    require('10-e');
  }, /Traversed too many nodes in the dependency tree. Possible cycle at module .+ or at a related module\./, 'dependency loop with other dependencies throws error');

});

QUnit.test('require.toUrl()', function(assert) { "use strict";
  assert.expect(6);

  assert.strictEqual(require.toUrl('foo'), 'foo.js', 'no slash, no extension');
  assert.strictEqual(require.toUrl('bar/foo'), 'bar/foo.js', 'with slash, no extension');
  assert.strictEqual(require.toUrl('foo.html'), 'foo.html', 'no slash, with extension');
  assert.strictEqual(require.toUrl('bar/foo.html'), 'bar/foo.html', 'with slash, with extension');
  assert.strictEqual(require.toUrl('foo.js'), 'foo.js', 'no slash, with js extension');
  assert.strictEqual(require.toUrl('bar/foo.js'), 'bar/foo.js', 'with slash, with js extension');
});

QUnit.test('require.defined()', function(assert) { "use strict";
  assert.expect(3);

  define('11-a', {});
  define('11-b', function() {});

  assert.strictEqual(require.defined('11-a'), true, 'require.defined() returns true for module defined as an object');
  assert.strictEqual(require.defined('11-b'), true, 'require.defined() returns true for a module defined with a factory function');
  assert.strictEqual(require.defined('11-c'), false, 'require.defined() returns false for a module not defined');

});

QUnit.test('delayBetweenRequireCallbacks', function(assert) {
  assert.expect(1);
  var ready = assert.async();

  define('12-a', {});

  require.config({ delayBetweenRequireCallbacks: 500 });

  var time;
  var getNow = typeof performance !== 'undefined' && performance.now
    ? performance.now.bind(performance)
    : function() { return (new Date()).getTime(); }
  ;

  require(['12-a'], function() {
    time = getNow();
  });

  require(['12-a'], function() {
    assert.ok(getNow() - time > 500, 'delay occurs before the following callback is called');
    ready();
  });

  require.ready();
  require.config({ delayBetweenRequireCallbacks: undefined });

});


QUnit.test('asynchronous require with error callback', function(assert) { "use strict";
  var ready = assert.async();

  require([
    '13-a'
  ], function() {
    assert.ok(0, 'no error was thrown')
  }, function(error) {
    assert.strictEqual(
      error, 
      'Module 13-a or one of its dependencies is not defined.',
      'error is passed to the error callback'
    );
  });

  // Force resolution of the above require, otherwise the
  // define below will happen first.
  require.ready();

  define('13-a', function() {
    return '13-a';
  });

  require([
    '13-a'
  ], function(dep) {
    assert.strictEqual(dep, '13-a', 'module can be defined later');
    ready();
  }, function() {
    assert.ok(0, "an error was passed to the error callback");
    ready();
  });

});

QUnit.test('onReady', function(assert) { "use strict";
  assert.expect(2);

  require.ready();

  assert.ok(root.onReadyThis, 'onReady callback is called after ready');
  assert.strictEqual(root.onReadyThis, root, "this of onReady callback is the root context's this");
});

QUnit.test('require.config()', function(assert) { "use strict";
  assert.expect(3);

  require.config({ testConfig: true });
  assert.strictEqual(require.config().testConfig, true, 'require.config() sets and retrieves configuration');

  assert.strictEqual(require.config().configObjectTest, 123, 'require uses config object defined as the variable require');
  require.config({ configObjectTest: 456 });
  assert.strictEqual(require.config().configObjectTest, 456, 'require.config() can override require config object');

});

QUnit.test('requirejs', function(assert) { "use strict";
  assert.expect(1);

  assert.strictEqual(requirejs, require, 'requirejs is the same as require');

});


