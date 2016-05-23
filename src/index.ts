/// <reference path="../typings/node/node.d.ts"/>
import {Options} from './options'
import {Runner} from './runner'
import {Parser} from './flags'
import * as os from 'os'

const version = "1.0.0-beta26";
console.log("Service discover - Version " + version);

let parser = new Parser("vulcain-discovery", "service discovery - version " + version); 
let flags = parser.run<Options>(new Options());

if(flags) 
{
    if (!flags.cluster) {
        console.log("Cluster argument is required.");
        process.exit(1);
    }
    if( ['private', 'public', 'all', 'dev'].indexOf(flags.proxyMode) < 0) {
        console.log("Invalid proxyMode argument.");
        process.exit(1);
    }
    
    console.log("Cluster : " + flags.cluster);
    flags.version = version;
    flags.hostName = os.hostname();
    let runner = new Runner(flags);
    runner.startAsync();
    console.log("Running...");
}
