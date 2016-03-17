/// <reference path="../typings/node/node.d.ts"/>
import {Options} from './options'
import {Runner} from './runner'
import {Parser} from './flags'

const version = "1.0.0-beta3";
console.log("Service discover - Version " + version);

let parser = new Parser("vulcain-discovery", "service discovery - version " + version); 
let flags = parser.run<Options>(new Options());

if(flags) {
    console.log("Cluster : " + flags.cluster);
    flags.version = version;
    let runner = new Runner(flags);
    runner.startAsync();
    console.log("Running...");
}
