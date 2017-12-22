//     athena/require 1.1.1
//     https://github.com/athenahealth/athena-require
//     (c) 2016-2017 athenahealth, Inc.
//
//     Author: Raymond Lam (rlam@athenahealth.com)
//
//     athena/require may be freely distributed under the MIT license


(function(undefined) { "use strict";

// The 'root' object, which is the global this (which is window in the context
// of the browser).
var _root = this;

// If a define is already present via another AMD loader or there is an existing
// requirejs instance, do not overwrite.
if (_root.define || _root.requirejs) {
  return;
}

// If we have to traverse this many nodes in a dependency tree, assume it has a
// cycle, and abort.
var MAX_TRAVERSAL = 1000000;

var _configuration = {
  delayBetweenRequireCallbacks: undefined, // If set, the delay in milliseconds
                                           // between each require callback.

  onReady: undefined, // If set, called after require is ready
                      // and has handled all queued callbacks.

  recordModuleTimes: true,  // Record time it takes to build modules if true.

  recordModuleTimeThreshold: 5.0, // Record timing for construction time of
                                  // individual module only if the time exceeds
                                  // this many milliseconds. (The individual
                                  // time will always be added to the
                                  // totalModuleTime.)

  warnings: true // Suppress console warnings if false.
};

// true if all of the defines on the page have had a chance to execute.
var _isReady = false;

// true if require is ready and all queued callbacks have finished.
var _readyCallbacksFinished = false;

// true if require callback handling is in the middle of a delay between callbacks.
var _flushNextTickCallbacksPaused = false;

// defined modules, in the form of:
// {
//  'module/one' : {
//    dependencies: [
//      'dep/one',
//      'dep/two'
//    ],
//    factory: function(..) {
//      ...
//    }
//  },
//  'module/two' : {
//    ...
//  }
// }
var _moduleMap = {};

// array of callback functions, to be called in order by _flushNextTickCallbacks
var _nextTickCallbacks = [];

// array of callback functions, to be called in order on page load
var _onLoadCallbacks = [];

// resolved modules, in the form of:
// {
//  'module/one' : resolution value,
//  'module/two' : resolution value
// }
var _resolved = {};

// track number of resolved modules
var _resolvedModuleCount = 0;

// timings on how long it took to resolve each module and corresponding dep tree
// in the form of:
// {
//  modules: {
//    'my/module' : {
//      ordering: in what order this module was resolved
//      time: number of millisconds spent resolving this module and its
//                 dependencies
//    },
//    'my/other/module' : { ... },
//    ...
//  }
//  totalModuleTime: total time spent resolving in milliseconds,
//  totalNumberOfModules: total number of modules whose times are reflected in totalModuleTime
// }
var _moduleTimes = {
  totalModuleTime: 0.0,
  totalNumberOfModules: 0,
  modules: {}
};

// Given a string that looks like a path to the module, returns the portion
// of the path that represents the 'directory' that contains the module. For
// example, given 'path/to/some/module', returns 'path/to/some'. Given
// 'my-module', returns an empty string
var _dirName = (function() {
  var cache = {};

  return function(path) {
    path = path || '';

    if (path in cache) {
      return cache[path];
    }

    var match = path.match(/(.+)\/[^\/]+/);
    var ret = (match
      ? match[1]
      : ''
    );
    cache[path] = ret;
    return ret;
  };
})();

// Sets a parameter in athena/require's configuration.
function _config(args) {
  if (args) {
    for (var key in args) {
      if (args.hasOwnProperty(key)) {
         _configuration[key] = args[key];
      }
    }
  }

  return _configuration;
}

// Given a module name, a list of dependencies, and a factory function,
// defines the module as such.
function _define() {
  var anonymousWarning = 'Encountered anonymously defined module. Modules must be properly compiled into named modules. Proceeding without defining this module.';
  var moduleName;
  var dependencies;
  var factory;
  var prebuilt;

  moduleName = arguments[0];

  if (arguments.length === 3) {
    dependencies = arguments[1];
    if ((typeof arguments[2]) === 'function') {
      factory = arguments[2];
    }
    else {
      prebuilt = arguments[2];
      factory = function() { return prebuilt; };
    }
  }
  else if (arguments.length === 2) {
    if (Object.prototype.toString.call(moduleName) !== '[object String]') {
      _warn(anonymousWarning);
      return;
    }

    dependencies = [];
    if ((typeof arguments[1]) === 'function') {
      factory = arguments[1];
    }
    else {
      prebuilt = arguments[1];
      factory = function() { return prebuilt; };
    }
  }
  else if (arguments.length === 1) {
    if ((typeof arguments[0]) === 'function') {
      _warn(anonymousWarning);
      return;
    }
  }

  if (arguments.length < 2) {
    throw new Error('Missing arguments.');
  }

  if (
    arguments.length > 3
    || !(
      Object.prototype.toString.call(moduleName) === '[object String]'
      && Object.prototype.toString.call(dependencies) === '[object Array]'
      && (typeof factory) === 'function'
    )
  ) {
    throw new Error('Invalid arguments.');
  }

  if (_moduleMap.hasOwnProperty(moduleName)) {
      _warn(moduleName + ' is already defined.');
  }
  else {
    _moduleMap[moduleName] = {
      dependencies: dependencies,
      factory: factory
    }
  }
}

// Returns whether or not a module has already been defined. Does not determine
// if a module has been resolved yet.
function _defined(moduleName) {
  return _moduleMap[moduleName] ? true : false;
}

// Manually and immediately flushes require callbacks waiting to be executed
function _flushNextTickCallbacks() {
  // This function can relinquish control of the JS thread, so
  // we explicitly disallow multiple simultaneous instances by
  // preventing new instances from starting while another is
  // active but in the middle of a delay between callbacks.
  if (_flushNextTickCallbacksPaused) return;

  (function _flush () {
    _flushNextTickCallbacksPaused = false;
    while (_nextTickCallbacks.length) {
      var callback = _nextTickCallbacks.pop();
      var success = callback();
      if (!success) {
        // non-fatal failure. Put back in the queue to be
        // tried again at the next invocation of
        // _flushNextTickCallbacks
        _nextTickCallbacks.push(callback);
        return;
      }

      // If a require callback delay is configured, relinquish
      // control of the JS thread and continue later.
      if (
        typeof _configuration.delayBetweenRequireCallbacks === 'number'
        && _nextTickCallbacks.length
      ) {
        _flushNextTickCallbacksPaused = true;
        setTimeout(_flush, _configuration.delayBetweenRequireCallbacks);
        return;
      }
    }

    // If require is ready and all callbacks have been handled,
    // trigger the onReady callback if applicable.
    if (_isReady && !_readyCallbacksFinished) {
      _readyCallbacksFinished = true;
      if (typeof _configuration.onReady === 'function') {
        _configuration.onReady.apply(_root);
      }
    }
  })();
}

// in the form of:
// {
//   totalModuleTime: total time in milliseconds spent building modules,
//   totalNumberOfModules: total number of modules built,
//   modules: {
//     'my/module' : {
//      ordering: in what order this module was resolved
//      time: number of milliseconds spent building this module
//            (not including dependencies).
//    },
//    'my/other/module' : { ... },
//    ...
//  }
// }
function _getModuleTimes() {
  return _moduleTimes;
}

// If _root.performance is available, returns the time since epoch to
// microsecond. precision. Otherwise, returns the time since epoch to
// millisecond precision, with no guarantee of monotonicity.
var _getNow = (_root.performance && _root.performance.now
  ? _root.performance.now.bind(_root.performance)
  : function() {
    return (new Date().getTime());
  }
);

// Given a module path, if it is a relative module path, returns the
// absolute form of the relative path given another module path. Otherwise
// simply returns that module path.
function _normalizeModulePath(modulePath, relativeToModulePath) {
  relativeToModulePath = relativeToModulePath || '';

  var currentPath;

  if (modulePath.substr(0, 2) === './') {
    currentPath = _dirName(relativeToModulePath);
    return (currentPath
      ? currentPath + modulePath.substr(1)
      : modulePath.substr(2)
    );
  }
  else if (modulePath.substr(0, 3) === '../') {
    currentPath = _dirName(relativeToModulePath);
    if (!currentPath) {
      throw new Error('Cannot resolve module path ' + modulePath + ' relative to' + relativeToModulePath);
    }

    var parentPath = _dirName(currentPath);

    return (parentPath
      ? parentPath + modulePath.substr(2)
      : modulePath.substr(3)
    );
  }
  else {
    return modulePath;
  }
}

// Queues up the given function to be executed at the next clock tick or
// manual flush.
//
// The given function should return true if it executed successfully, or
// false if it executed unsuccessfully but non-fatally and should be put
// back in the queue in front to be tried again later.
function _nextTick(func) {
  // If _nextTickCallbacks is populated, we don't need to setTimeout,
  // because _nextTickCallbacks being populated means we already invoked
  // a setTimeout.
  if (!_nextTickCallbacks.length) {
    setTimeout(_flushNextTickCallbacks, 0);
  }

  _nextTickCallbacks.unshift(func);
}

// Execute the given callback when the 'load' event fires on the _root,
// or immediately if the document's readyState is 'complete'.
function _onLoad(callback) {
  var flushOnLoadCallbacks = function() {
    while (_onLoadCallbacks.length) {
      _onLoadCallbacks.pop()();
    }
  };

  if (
    !_onLoadCallbacks.length // If we have onLoad callbacks queued, it means
                             // that we've already called _onLoad before the
                             // document was complete, which means that we
                             // already have the load handlers attached to flush
                             // the call backs, so we don't need to attach the
                             // load handlers again.

    && _root.document // Attaching load handlers only really makes sense where
                      // we are in a browser context with a document.

    && _root.document.readyState !== 'complete' // Don't bother attaching load
                                                // handlers if the document is
                                                // already complete, because
                                                // they'll never fire.
  ) {
    if (_root.addEventListener) {
      _root.addEventListener('load', flushOnLoadCallbacks);
    }
    else if (_root.attachEvent) {
      _root.attachEvent('onload', flushOnLoadCallbacks);
    }
  }

  _onLoadCallbacks.unshift(callback);

  // If the document is already complete, flush the callbacks.
  if (_root.document &&  _root.document.readyState === 'complete') {
    flushOnLoadCallbacks();
  }
  // If we are oddly in a situation where there is no document (like we're not a
  // browser?), just defer flushing of the callbacks.
  else if (!_root.document) {
    setTimeout(flushOnLoadCallbacks, 0);
  }

}

// Sets _isReady to true and flushes the next tick callback queue. When
// _isReady is false and a module is not found, it is assumed that all the
// defines have not yet had a chance to execute, and pending resolutions
// waiting on the module should wait until _ready() is invoked (either
// manually or on page load). When _isReady is true, modules not found is
// a fatal error.
function _ready() {
    _isReady = true;
    _flushNextTickCallbacks();
}

// If given a module name as its only argument, resolves that module and
// returns it. If given as arguments an array of module names and a
// callback function, asynchronously resolves all of the modules, and then
// calls the callback function with the resolved modules as arguments in order.
function _require() {
  if (arguments.length === 1) {
    // synchronous require call -- attempt to return module immediately
    var modulePath = arguments[0];
    var resolveStatus = _resolveTree({ modulePaths: [modulePath] });

    if (resolveStatus.success) {
      return _resolved[modulePath];
    }
    else {
      _throwResolveError(resolveStatus);
    }
  }
  else if (arguments.length === 2) {
    var modulePaths = arguments[0];
    var callback = arguments[1];

    // asynchronous require call -- wait until the next tick, when
    // in theory all of the defines on the have executed, before
    // executing the given callback.
    _nextTick(function() {
      var resolveStatus = _resolveTree({
        modulePaths: modulePaths,
        onSuccess: function() {
          var callbackArgs = [];
          for (var i = 0; i < modulePaths.length; ++i) {
            callbackArgs.push(_resolved[modulePaths[i]]);
          }
          callback.apply(_root, callbackArgs);
        }
      });

      // If the tree is resolved immediately or will be resolved later, return true
      // to move on to the next item in the callback queue.
      if (resolveStatus.success || resolveStatus.deferred) {
        return true;
      }
      // If all modules have been defined and we can't find the one we're
      // looking for, throw an error.
      else if (_isReady && resolveStatus.moduleNotDefined) {
        _throwResolveError(resolveStatus);
      }
      // If all modules have not yet been defined, and the resolve status is
      // something other than success or deferred, return false to put this
      // callback back into the queue, to be tried again later.
      else {
        return false;
      }
    });
  }
  else {
    throw new Error('Invalid arguments.');
  }
}

// Resolves the dependency tree of the given modules. Takes an args object:
// {
//  modulePaths: an array to the paths of modules whose dependency trees are to
//               be resolved,
//
//  resolveStack: alternative to modulePaths. pass in a resolve stack in order
//                to have _resolveTree continue resolving a dependency tree
//                given the state of the stack.
//
//  onSuccess: a function to execute when the dependency tree has been
//             successfully resolved.
//
// }
//
// Returns an object:
// {
//   success: true if resolution was a complete and immediate success,
//
//   moduleNotDefined: set to the full path of a module which has not (yet) been
//                     defined,
//
//   deferred: set to the full path of a dependency which could not be
//             immediately resolved. dependency tree resolution will
//             automatically continue where it left off when this
//             module is available. This status is for when the dependency is
//             actually a plugin invocation which is deferred and asynchronously
//             executed.
// }
function _resolveTree(args) {
  var i;
  var resolveStack;

  // The general algorithm for module resolution is a DFS tree-traversal, iteratively
  // using a stack.

  // If a resolveStack is passed in, it's as if _resolveTree is continuing where
  // it previously left off.
  if (args.resolveStack) {
    resolveStack = args.resolveStack;
  }
  // If there's only one modulePath, and it is already resolved, short-circuit
  // everything
  else if (
    args.modulePaths.length === 1
    && _resolved.hasOwnProperty(args.modulePaths[0])
  ) {
    if (args.onSuccess) {
      args.onSuccess();
    }

    return { success: true };
  }
  // Start the DFS rooted at the passed in module paths
  else {
    resolveStack = [];
    i = args.modulePaths.length;
    while (i--) {
      resolveStack.push({
        modulePath:  args.modulePaths[i]
      });
    }
  }

  var currentNode;

  var numberOfTraversedNodes = 0;

  // This is a pretty long loop block, and one might expect such a long block of
  // code to be broken up into smaller functions, but the intent here is to keep
  // as much code inline as possible (while staying reasonably DRY), in order to
  // maximize performance.

  // Keep traversing while we still have nodes to traverse.
  while (currentNode = resolveStack.pop()) {

    // ! indicates the invocation of a plugin.
    var bangIndex;

    // Will be true if currentNode.modulePath is an exact match for an entry in
    // _moduleMap.
    var modulePathIsExactMatch;

    // If the given module path matches exactly to a resolved module, we can
    // assume it is a full module path, and skip the work of resolving.
    if (_resolved.hasOwnProperty(currentNode.modulePath)) {
      currentNode.fullModulePath = currentNode.modulePath;

      // The module is already resolved, so there are no dependencies that need
      // resolving.
      currentNode.numberOfDependencies = 0;
    }
    // It is possible to hit this branch due to a previous invocation of
    // _resolveTree that was deferred and then continued.
    else if (
        currentNode.fullModulePath
        && _resolved.hasOwnProperty(currentNode.fullModulePath)
    ) {

      // The module is already resolved, so there are no dependencies that need
      // resolving.
      currentNode.numberOfDependencies = 0;
    }
    // if ordinary module dependency (i.e., not a plugin invocation)
    else if (
      // Track if the modulePath happens to be an exact match in _moduleMap
      (modulePathIsExactMatch = _moduleMap.hasOwnProperty(currentNode.modulePath))

      // If modulePath is in the _moduleMap, definitely not a plugin invocation,
      // so short circuit and don't bother checking for bangIndex.
      || (bangIndex = currentNode.modulePath.indexOf('!')) < 1
    ) {
      // Normalize the module path to its full module path. We will from now on
      // only be referring to the module by its full path.

      // Don't bother checking to see if we need to normalize the module path
      // if the module path is an exact match for a module definition.
      if (!modulePathIsExactMatch && currentNode.modulePath.charAt(0) === '.') {
        currentNode.fullModulePath = _normalizeModulePath(currentNode.modulePath, currentNode.parentNode ? currentNode.parentNode.fullModulePath : '');
      }
      else {
        currentNode.fullModulePath = currentNode.modulePath;
      }

      // Return if the module is not yet defined. All the scripts might not have
      // been loaded yet, or the module definitions may simply be missing.
      if (!_moduleMap.hasOwnProperty(currentNode.fullModulePath)) {
        return { moduleNotDefined: currentNode.fullModulePath };
      }
    }
    // else is a plugin invocation
    else {
      // Break out the path to the plugin, and the plugin argument, which is likely
      // to be a module path. bangIndex is already defined above.
      var pluginPath = currentNode.modulePath.substr(0, bangIndex);
      var pluginArg = currentNode.modulePath.substr(bangIndex + 1);

      // Always normalize the plugin path.
      if (pluginPath.charAt(0) === '.') {
        pluginPath = _normalizeModulePath(pluginPath, currentNode.parentNode
          ? currentNode.parentNode.fullModulePath
          : ''
        );
      }

      // If the plugin module is already resolved, just retrieve it. Otherwise,
      // we must resolve it.
      var plugin = _resolved[pluginPath];
      if (!plugin) {

        // Resolve the plugin. We don't need to pass a success handler because
        // we need the resolve to return sucess, or else we are just going to
        // return immediately with non-success.
        var pluginStatus = _resolveTree({
          modulePaths: [pluginPath]
        });

        // If we've succeeded in resolving the plugin right away, we can
        // retrieve it and continue.
        if (pluginStatus.success) {
          plugin = _resolved[pluginPath];
        }
        // Otherwise, we'll have to pause resolving until later.
        else {
          return pluginStatus;
        }
      }

      // If the plugin has a normalize function, apply it to the plugin
      // argument,which needs to be normalized using the built-in normalizer
      // first.
      if (plugin.normalize) {
        pluginArg = plugin.normalize(pluginArg, function(arg) {
          if (arg.charAt(0) === '.') {
            return _normalizeModulePath(arg, currentNode.parentNode ? currentNode.parentNode.fullModulePath : '');
          }
          else {
            return arg;
          }
        });
      }
      // Otherwise, just normalize the plugin argument.
      else if (pluginArg.charAt(0) === '.') {
        pluginArg = _normalizeModulePath(pluginArg, currentNode.parentNode ? currentNode.parentNode.fullModulePath : '');
      }

      // fullModulePath is both normalized paths separated by a !. This is how
      // the result of the plugin invocation will be stored in _resolved.
      currentNode.fullModulePath = pluginPath + '!' + pluginArg;

      // Plugin invocations never have dependencies directly.
      currentNode.numberOfDependencies = 0;

      // Now, actually apply the plugin to the argument, unless we have already
      // done so.
      if (!_resolved.hasOwnProperty(currentNode.fullModulePath)) {

        var pluginLoadIsSynchronous = true;
        plugin.load(pluginArg, _require, function(result) {

          // Store the result of the plugin invocation by the
          // normalized paths.
          _resolved[currentNode.fullModulePath] = result;
          ++_resolvedModuleCount;

          // If the plugin is applied immediately and synchronously,
          // pluginLoadIsSynchronous will still be true by the time
          // we reach this line. If pluginLoadIsSynchronous is false,
          // then that means we are executing this line at some point
          // after the outer _resolveTree call has already returned
          // with a deferred status, so we must start the _resolveTree
          // again, using the resolveStack in the state that it was at,
          // and the same success handler.
          if (!pluginLoadIsSynchronous) {

            // Put the current node back on the resolveStack, because
            // when we continue to resolve, we will need to finish
            // processing it.
            resolveStack.push(currentNode);
            _resolveTree({
              resolveStack: resolveStack,
              onSuccess: args.onSuccess
            });
          }
        }, _configuration);

        // If we get this far and have not stored the result of the
        // plugin invocation into _resolved, it means that the plugin
        // invocation will be asynchronous, so set the flag as such,
        // and return with a deferred status. _resolveTree will continue
        // when the plugin has been applied.
        if (!_resolved.hasOwnProperty(currentNode.fullModulePath)) {
          pluginLoadIsSynchronous = false;
          return { deferred: currentNode.fullModulePath };
        }
      }
    }

    // By this point, currentNode must have a fullModulePath.
    if (_resolved.hasOwnProperty(currentNode.fullModulePath)) {
      // The module is already resolved, so there are no dependencies that need
      // resolving.
      currentNode.numberOfDependencies = 0;
    }
    else {
      currentNode.factory = _moduleMap[currentNode.fullModulePath].factory;
      currentNode.numberOfDependencies = _moduleMap[currentNode.fullModulePath].dependencies.length;

      // Pre-sized array, which will be filled with resolved dependencies, in
      // the order that they were injected in the define statement.
      currentNode.resolvedDependencies = new Array(currentNode.numberOfDependencies);

      currentNode.numberOfResolvedDependencies = 0;

      // The fastest way to loop though an array is backwards, using the
      // decrement operator
      i = currentNode.numberOfDependencies;
      while (i--) {
        var dependencyString = _moduleMap[currentNode.fullModulePath].dependencies[i];

        // If the dependency is already resolved, simply put it into our list
        // of resolved dependencies.
        if (_resolved.hasOwnProperty(dependencyString)) {
          currentNode.resolvedDependencies[i] = _resolved[dependencyString];
          ++currentNode.numberOfResolvedDependencies;
        }
        // CommonJS style exports.
        else if (
          dependencyString === 'module'
          || dependencyString === 'exports'
        ) {

          currentNode.commonJS = currentNode.commonJS || {
            id: currentNode.fullModulePath,
            exports: {}
          };

          currentNode.resolvedDependencies[i] = (dependencyString === 'module'
            ? currentNode.commonJS
            : currentNode.commonJS.exports
          );

          ++currentNode.numberOfResolvedDependencies;
        }
        // Else, the dependency may or may not be resolved already.
        else {

          // Push the node onto the resolve stack for traversal. If it turns out
          // that the dependencyString is a relative module path, and we
          // actually have already resolved it, we will discover this at the top
          // of this loop when we pop the node and normalize the modulePath.
          // Make sure this child node has a link back to the parent (the
          // current node),and that it knows its position in the current node's
          // list of dependencies.
          resolveStack.push({
            modulePath: dependencyString,
            parentNode: currentNode,
            dependencyPosition: i
          });
        }
      }
    }

    // If all of the the current node's are resolved...
    while (
      currentNode
      && (currentNode.numberOfResolvedDependencies || 0) === currentNode.numberOfDependencies
    ) {
      // By this point, currentNode must have a at a minimum modulePath,
      // factory, fullModulePath, resolvedDependencies, and numberOfDependencies
      // defined.If currentNode has a parentNode, it must also have a
      // dependencyPosition.
      var fullModulePath = currentNode.fullModulePath;

      // Only resolve the module once.
      if (!_resolved.hasOwnProperty(fullModulePath)) {
        var startTime = _getNow();
        _resolved[fullModulePath]= currentNode.factory.apply(_root, currentNode.resolvedDependencies);
        var moduleTime = (_getNow() - startTime);
        ++_resolvedModuleCount;

        if (_configuration.recordModuleTimes) {
          _moduleTimes.totalModuleTime += moduleTime;
          ++_moduleTimes.totalNumberOfModules;

          if (moduleTime > _configuration.recordModuleTimeThreshold) {
            _moduleTimes.modules[fullModulePath] = {
              time: moduleTime,
              ordering: _resolvedModuleCount
            };
          }
        }

        // Apply the CommonJS style exports only if there is no return from the
        // factory.
        if ((typeof _resolved[fullModulePath]) === 'undefined' && currentNode.commonJS) {
          _resolved[fullModulePath] = currentNode.commonJS.exports;
        }
      }

      // If the currentNode is a child (dependency) of another node, save the
      // resolved module into the dependency list of the parent in the correct
      // position.
      var parentNode = currentNode.parentNode;
      if (parentNode) {
        parentNode.resolvedDependencies[currentNode.dependencyPosition] = _resolved[fullModulePath];
        ++parentNode.numberOfResolvedDependencies;

        // Conservative garbage collectors sometimes fail to collect objects
        // which are collectable. If currentNode fails to be collected, better
        // better to leak just currentNode rather than it and all of its
        // parents, so dismantle the dependency tree on the way up.
        delete currentNode.parentNode;
      }

      // The resolution of the currentNode might mean that the parent node can
      // also be resolved, so go up the dependency tree.
      currentNode = parentNode;
    }

    // If we've traversed an unreasonable number of nodes, there's probably a
    // cycle.
    if (++numberOfTraversedNodes > MAX_TRAVERSAL) {
      throw new Error(
        'Traversed too many nodes in the dependency tree. Possible cycle at module '
        + (currentNode.fullModulePath || currentNode.modulePath)
        + ' or at a related module.'
      );
    }
  }

  // If we get this far, the dependency resolution was a complete success.
  if (args.onSuccess) {
    args.onSuccess();
  }

  return { success: true };
}

// Stop timing the module building, and returns the timings that have been recorded
function _stopTimer () {
  _config({ recordModuleTimes: false });

  return _getModuleTimes();
}

// Throws an error with consistent messenging. Takes as its output the return of
// _resolveTree
function _throwResolveError(resolveStatus) {
  if (resolveStatus.moduleNotDefined) {
    throw new Error(
      'Module '
      + resolveStatus.moduleNotDefined
      + ' or one of its dependencies is not '
      + (_isReady
        ? ''
        : 'yet '
      )
      + 'defined.'
    );
  }
  else if (resolveStatus.deferred) {
    throw new Error (resolveStatus.deferred + ' is not yet ready.');
  }
  else {
    throw new Error(
      'Unknown error: ' + JSON.stringify(resolveStatus)
    );
  }
}

// A minimal implementation of require.toUrl, because athena/require is designed
// to work in compiled JavaScript, so turning module paths into URLs for the
// most part makes no sense. Simply returns the given path plus the '.js'
// extension if there does not appear to be an extension.
function _toUrl(modulePath) {
  var match = modulePath.match(/\.[^\/]+$/);
  if (match) {
    return modulePath;
  }
  else {
    return modulePath + '.js';
  }
}

// Warns to the console the given message, unless there is no console, or unless
// warnings are turned off.
function _warn(message) {
  if (_configuration.warnings && _root.console && _root.console.warn) {
    _root.console.warn(message);
  }
}

// If config options were specified in advance, set them now.
if (_root && _root.require && typeof _root.require === 'object') _config(require);

// publish our functions
_root.define = _define;
_root.require = _require;
_root.require.ready = _ready;
_root.require.getTimes = _getModuleTimes;
_root.require.stopTimer = _stopTimer;
_root.require.defined = _defined;
_root.require.config = _config;
_root.require.toUrl = _toUrl;
_root.requirejs = _root.require;

// Expose the resolved module registry
_root.require._resolved = _resolved;

// Mark define as the AMD define, specifying that this is the Athena flavor of
// AMD.
_root.define.amd = {
  athena: true
};

// when the page is fully loaded, all defines should have executed, so indicate
// that we are ready
_onLoad(_ready);

// Make require available as a module..
_define('require', function() {
  return _require;
});

}).call(this); // Pass _root or whatever 'this' is into the IIFE
