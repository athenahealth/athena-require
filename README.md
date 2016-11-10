# athena/require

A fast [AMD](https://github.com/amdjs/amdjs-api/wiki/AMD) loader for use with compiled JavaScript as a replacement for [RequireJS](http://requirejs.org).

## Usage

athena/require is to be used with compiled JavaScript, where the modules are explicitly named and defined inline. [r.js](http://requirejs.org/docs/optimization.html) is an example of JavaScript compiler that will build, bundle, and explicitly name AMD modules.

## Motivation

Compiling JavaScript modules is the way to maximize performance of a web page built using AMD. athena/require is a fast AMD loader designed explicitly for compiled AMD JavaScript, being 3 times smaller than RequireJS, and performing with 2-3 times less overheard.

## Support

athena/require supports:

* synchronous and asynchronous forms of `require` and `requirejs`
* named module definitions
* dependencies with relative IDs
* plugins which do not rely on dynamic loading of resources (plugins which call `require` to load resources that have already been inlined are supported, as are plugins that dynamically load resources through other means, such as raw AJAX)
* 'module', 'exports', and 'require' pseudo-dependencies

athena/require expects modules to be explicitly named and defined inline (i.e., "optimized"). athena/require does not support dynamic loading.

athena/require does expose a `require.toUrl()` method, but it is a minimal implementation and it is best to avoid using it.

## Additional features

### module timing

By default, athena/require records the time it takes to execute each module's factory function. The timings are exposed by the `require.getTimes()` method, as an object in the form of:

    {
      "totalModuleTime"      : total time spent executing factory functions in milliseconds,
      "totalNumberOfModules" : total number of modules whose times are reflected in totalModuleTime,
      
      "modules" : {
        "my/first/module" : {
           "ordering" : the ordering in which my/first/module was resolved,
           "time"     : time spent executing my/first/module's factory function, in milliseconds,
         },
         "my/second/module" : { ... },
         ...
      }
    }
    
Module timing can be turned off by setting the `recordModuleTimes` config to `false` (`require.config({ recordModuleTimes: false });`), or by calling `require.stopTimer()` (which also returns the timings);

When timings are enabled, all factory function times will be added to `totalModuleTime`, and all modules will count towards `totalNumberOfModules`. However, only modules whose factory functions exceed a configured threshold will be recorded individually under `modules`. This threshold can be configured under `recordModuleTimeThreshold` (`require.config({ recordModuleTimeThreshold: thresholdInMilliseconds });`), which defaults to 5.0.

### ready

By default, athena/require will wait until the `load` event of `window` before assuming that all modules that are to be defined have been defined. Before the `load` event, athena/require will attempt to service asynchronous `require` calls, but if an as-of-yet undefined module is encountered in the dependency tree of the required module(s), athena/require will wait all the way until the `load` event before trying again, after which point dependencies on undefined modules will be fatal. This default behavior is conservative; the `load` event signals that all assets on the page have been loaded (and all scripts executed), which means that all calls to `define` should have executed. 

athena/require does not need to wait until the `load` event if it is told exactly when all modules have been defined. Calling `require.ready()` tells athena/require that all modules have been defined and it is safe to begin immediately servicing asynchronous `require` calls. By placing a call to `require.ready()` at the very end of the script (or even simply after the very last module definition), apparent page render performance can be drastically improved.

### warnings

`require.config({ warnings: false });` to disable console warnings.

## Author

Raymond Lam (rlam@athenahealth.com)

## License

MIT
