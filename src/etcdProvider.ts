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
var Etcd =require('node-etcd')
import {ContainerInfo} from './discover'
import {Options} from './options'
import {IProvider} from './reporter'

// vulcain/<cluster>/runtime/services/<host>/<name>/<version>/<id>
// vulcain/<cluster>/runtime/hosts/<host>
export class EtcdProvider implements IProvider 
{
    private etcd;
    
    constructor(private options:Options) 
    {
        this.etcd = new Etcd(options.kv || "local-store", 2379);  
        console.log("Starting consul reporter on " + (options.kv || "local-store"));
    }
               
    setAsync(key:string, value, lock) 
    {
        return new Promise((resolve, reject) => {
            try {
                this.etcd.set(
                    key, 
                    value,
                    {},
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
   
    createSessionAsync() 
    {
        return this.renewSessionAsync();
    }
    
    renewSessionAsync() 
    {
        return new Promise((resolve, reject) => 
        {
            try {
                if(this.options.debug)
                    console.log(">> Renew session at " + Date.now().toLocaleString());
                    
                this.etcd.mkdir(
                    `vulcain/${this.options.cluster}/runtime/services/${this.options.hostName}`, 
                    {ttl:this.options.ttl, prevExist:true}, (err)=>
                    {
                        if(err) 
                            reject(err);
                        else
                            resolve();
                    }
                );
                
                this.etcd.mkdir(
                    `vulcain/${this.options.cluster}/runtime/hosts/${this.options.hostName}`, 
                    {ttl:this.options.ttl, prevExist:true}, 
                    (err)=>
                    {
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
    
    getAsync(key:string, recurse?:boolean) : Promise<any> {
        return new Promise((resolve, reject) => {
            try {
                this.etcd.get(
                    key,
                    {recursive:!!recurse},
                    (err,data) => {
                    if(err) 
                        reject(err);
                    else {
                        resolve(data && data.node && data.node.value);
                    }
                });
            }
            catch(e) {reject(e);}
        });
    }
    
    removeAsync(key:string, recurse?:boolean) 
    {
        return new Promise((resolve, reject) => {
            try {
                this.etcd.del(key, {recursive:!!recurse},
                (err) => {
                    if(err) 
                        reject(err);
                    else
                        resolve();
                });
            }
            catch(e) {reject(e);}
        });        
    }
    
    watchChanges(key:string, queue, recurse:boolean, panic: (err)=>void) 
    {
        let self = this;
        let ctx = {
            watch : this.etcd.watcher(key, null, {recursive:recurse})
        };

        ctx.watch.on('change', function(data) {
            if(data) 
            {
                queue.onNext(data);
            }
        });

        ctx.watch.on('error', function(err) {
            panic(err);
        });
        
        return ctx;
    }
}