//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.
//
//    Copyright (c) Zenasoft
//
import {DefaultArgument, Argument, Verb, Section} from './flags'

export class Options 
{
    @Argument({name:"services-advertise", description:"Address used to exposed service", defaultValue:null})    
    hostIp:string;
    @Argument({name:"ttl", description:"Session time to live in seconds (default 30)", defaultValue:30})
    ttl:number;
    @Argument({name:"kv", description:"KV address", defaultValue:null})
    kv:string;
    @Argument({name:"D", alias:"debug", description:"Set verbose information", defaultValue:false})
    debug:boolean;
    @Argument({name:"certs", description:"Path to docker certificate files", defaultValue:null})
    certs:string;
    @Argument({name:"H", description:"Daemon socket(s) to connect to"})
    dockerAddress:string;
    @Argument({name:"cluster", description:"Cluster name", env:"VULCAIN_CLUSTER"})
    cluster:string;
    @Argument({name:"refresh", description:"HAProxy configuration reload interval in seconds.", defaultValue:5})
    refresh:number;
    @Argument({name:"proxy-mode", description:"Service exposition (public|private|all|dev).", defaultValue:"private"})
    proxyMode:string;
    @Argument({name:"template", description:"TemplateFileName", defaultValue:"haproxy.tpl"})
    templateFileName:string;
    @Argument({name:"target-file", description:"Config file name", defaultValue:"/var/haproxy/haproxy.cfg"})
    configFileName:string;
    @Argument({name:"proxy-address", description:"Proxy address", defaultValue:null})
    proxy:string;
    
    version:string;
    hostName:string;
}
