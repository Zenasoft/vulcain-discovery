var os = require('os');
var Path = require('path');

var gulp = require("gulp"),
    ts = require("gulp-typescript"),
    merge = require('merge2'),
    chmod = require('gulp-chmod'),
    filter = require('gulp-filter'),
    fse = require('fs-extra'),
 //   insert = require('gulp-insert'),
    sourcemaps = require('gulp-sourcemaps'),
    concat = require("gulp-concat")
    ;

var rootDir = "file://" + __dirname + "/src";

// https://www.npmjs.com/package/gulp-typescript
gulp.task("compile-ts", function ()
{
    var tsProject = ts.createProject(
        './src/tsconfig.json',
        {
            sortOutput: true,
            typescript: require('typescript')    // must a project package dependency
        });

    var tsResult =
        tsProject.src('src/**', { base: 'src' })
            .pipe(sourcemaps.init())
           // .pipe(insert.prepend('"use strict";'))
            .pipe(ts(tsProject));

    var mainFilter = filter('main.js', {restore:true});
    
    return merge([
            tsResult.dts
                .pipe(concat('index.d.ts'))
                .pipe(gulp.dest('lib')),
            tsResult.js
                .pipe(mainFilter)
                .pipe(chmod(755))
                .pipe(mainFilter.restore)
                //       .pipe(concat('index.js'))
                .pipe(sourcemaps.write('.', {includeContent:false, sourceRoot: rootDir}))
                .pipe(gulp.dest('lib'))
        ]
    );
});

gulp.task('clean', function(done) { fse.remove('lib', done);});

gulp.task('watch-ts', function () 
{
    return gulp.watch('src/**/*.ts', function (files)
    {
        console.log("Changes detected. Compiling ts files...");
        gulp.start('compile-ts'); // run the compile task
    });
});
