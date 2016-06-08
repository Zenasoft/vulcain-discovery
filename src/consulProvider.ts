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
var Consul = require('consul');
import {ContainerInfo} from './discover'
import {Options} from './options'
import * as util from 'util'
import {IProvider} from './reporter'

// vulcain/<cluster>/runtime/services/<host>/<name>/<version>/<id>
// vulcain/<cluster>/runtime/hosts/<host>
export class ConsulProvider implements IProvider
{
    private consul;
    private sessionId:string;
   
    constructor(private options:Options) 
    {
        this.consul = Consul({ host:options.kv || "local-store"});  
    }

    setAsync(key:string, value, lock?:boolean) 
    {
        if(lock === undefined)
            lock = true;
            
        if(this.options.debug) {
            console.log("Set %s with lock=" + lock, key);
        }
        return new Promise((resolve, reject) => 
        {
            let options = lock ? { acquire: this.sessionId } : {};
            try {
                this.consul.kv.set(
                    key,
                    value,
                    options, 
                    (err) => {
                        if(err)
                            reject(err);
                        else
                            resolve();
                    }
                );
            }
            catch(e) {reject(e);}
        });  
    }
    
    removeAsync(key:string, recurse?:boolean) 
    {
        return new Promise<any>((resolve, reject) => 
        {
            try {
                this.consul.kv.del({key:key, recurse:!!recurse}, (err,data) => {
                    if(err) 
                        reject(err);
                    else {
                        resolve(data);
                    }
                });
            }
            catch(e) {reject(e);}
        });   
    }
    
    getAsync(key:string, recurse?:boolean) 
    {
        return new Promise<any>((resolve, reject) => 
        {
            try {
                this.consul.kv.get({key:key, recurse:!!recurse}, (err,data) => {
                    if(err) 
                        reject(err);
                    else {
                        resolve(data);
                    }
                });
            }
            catch(e) {reject(e);}
        });   
    }
    
    createSessionAsync() 
    {
        let self = this;
        return new Promise((resolve, reject) => 
        {
            console.log("Creating a session with ttl=" + this.options.ttl);
            try {
                this.consul.session.create({ttl:`${this.options.ttl}s`, behavior:"delete", lockDelay:"1s"}, (err,data)=>
                {
                    if(err) {
                        reject(err);
                    }
                    else {
                        this.sessionId = data.ID;
                        console.log("Consul session initialized with id=" + this.sessionId);                    
                        resolve(data.ID);
                    }
                });    
            }
            catch(e) {
                reject(e);
            }
        });
    }
    
    renewSessionAsync() 
    {
        return new Promise((resolve, reject) => 
        {            
            try {
                this.consul.session.renew(this.sessionId, (err,data) => {
                    if(err) {
                        util.log("Renew failed " + err);
                        reject(err);
                    }
                    else {
                        if(this.options.debug)
                            util.log("Renew ok ");
                        resolve(data);
                    }
                });
            }
            catch(e) {reject(e);}
        });        
    }
       
    watchChanges(key:string, queue, recurse:boolean, panic: (err)=>void) 
    {
        let self = this;
        let ctx = { watch: null, dispose: function () { this.watch.end();}};
       
        ctx.watch = this.consul.watch({ method: this.consul.kv.get, options: { recurse:recurse, key: key }});

        ctx.watch.on('change', function(data, res) 
        {
            if(data) 
            {
                console.log("Changes detected on key %s ....", key);
                queue.onNext(data.Value);
            }
        });

        ctx.watch.on('error', function(err) 
        {
            ctx.watch.end();
            panic(err);
        });
        
        return ctx;
    }    
}